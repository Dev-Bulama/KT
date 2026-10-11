import { beforeAll, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { prisma, resetDb, makeUser, actor as loadA } from "./helpers";
import { registerMda, reviewMda, activateMda, createInvitation, acceptInvitation } from "@/modules/mdas/service";
import { login, verifyEmail, requestPasswordReset, resetPassword, completeMfa, beginMfaEnrollment, confirmMfaEnrollment } from "@/modules/auth/service";
import { validateSessionToken } from "@/modules/auth/session";
import { issueToken } from "@/modules/auth/tokens";
import { planMdaImport, applyMdaImport } from "@/modules/mdas/import";
import { loadActor, type Actor } from "@/modules/rbac/actor";
import { decrypt } from "@/lib/crypto";

const reg = (email: string, name = "TEST Ministry of Onboarding", abbreviation = "TMO", claimMdaId?: string) => ({
  representative: { name: "Rep Person", email, phone: "+234 800 111 2222", designation: "Director ICT", password: "Strong-Passw0rd-1" },
  claimMdaId,
  profile: { name, abbreviation, category: "MINISTRY", address: "Secretariat, Katsina", officialEmail: "info@tmo.test.invalid", officialPhone: "+234 800 000 0001", contactPersonName: "Permanent Secretary", contactPersonDesignation: "PS" },
});

describe("MDA onboarding and authentication", () => {
  let reviewer: Actor;
  beforeAll(async () => {
    await resetDb();
    reviewer = await makeUser("OPERATIONS_ADMIN");
  });

  it("registration → email verification → review → activation → staff invitation", async () => {
    const r = await registerMda(reg("rep@tmo.test.invalid"));
    expect(r.message).toMatch(/verification email/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "rep@tmo.test.invalid" }, include: { membership: { include: { mda: true } } } });
    expect(user.status).toBe("PENDING_VERIFICATION");
    expect(user.membership!.mda.status).toBe("PENDING_REVIEW");
    expect(user.membership!.mda.submittedAt).toBeNull();
    // Unverified users cannot sign in.
    expect((await login("rep@tmo.test.invalid", "Strong-Passw0rd-1")).ok).toBe(false);
    // Email verification submits the profile to KATDICT.
    const token = await issueToken(prisma, user.id, "EMAIL_VERIFICATION");
    expect((await verifyEmail(token)).ok).toBe(true);
    expect((await verifyEmail(token)).ok).toBe(false); // single use
    const mda = await prisma.mda.findUniqueOrThrow({ where: { id: user.membership!.mdaId } });
    expect(mda.submittedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: reviewer.id, type: "mda.registration_received" } })).toBe(1);
    // Before approval, the MDA user cannot submit requests.
    let rep = (await loadActor(prisma, user.id, null))!;
    expect(rep.permissions.has("request.create")).toBe(false);
    expect(rep.permissions.has("mda.profile.edit.own")).toBe(true);
    await expect(activateMda(rep)).rejects.toThrow(/approved/);
    await reviewMda(reviewer, mda.id, "APPROVE", "Verified by phone with the PS office", mda.version);
    const approved = await prisma.mda.findUniqueOrThrow({ where: { id: mda.id } });
    expect(approved.reviewedById).toBe(reviewer.id);
    expect(approved.approvedAt).not.toBeNull();
    rep = (await loadActor(prisma, user.id, null))!;
    await activateMda(rep);
    rep = (await loadActor(prisma, user.id, null))!;
    expect(rep.mdaStatus).toBe("ACTIVE");
    expect(rep.permissions.has("request.create")).toBe(true);
    // Invite staff and accept.
    const inv = await createInvitation(rep, { email: "staff@tmo.test.invalid", roleKeys: ["MDA_STAFF"] });
    await expect(createInvitation(rep, { email: "evil@tmo.test.invalid", roleKeys: ["SUPER_ADMIN"] })).rejects.toThrow();
    await acceptInvitation(inv.devToken!, { name: "Staff Member", password: "Strong-Passw0rd-2" });
    await expect(acceptInvitation(inv.devToken!, { name: "Again", password: "Strong-Passw0rd-2" })).rejects.toThrow();
    const staff = await prisma.user.findUniqueOrThrow({ where: { email: "staff@tmo.test.invalid" }, include: { membership: true, roles: { include: { role: true } } } });
    expect(staff.membership?.mdaId).toBe(mda.id);
    expect(staff.roles.map((x) => x.role.key)).toEqual(["MDA_STAFF"]);
  });

  it("does not allow impersonating an already-registered MDA by name", async () => {
    await expect(registerMda(reg("other@tmo.test.invalid", "TEST Ministry of Onboarding", "TMO2"))).rejects.toThrow(/already registered/);
  });

  it("does not reveal whether an email is registered", async () => {
    const r = await registerMda(reg("rep@tmo.test.invalid", "TEST Different Agency", "TDA"));
    expect(r.message).toMatch(/If the details can be registered/);
    expect(await prisma.mda.findUnique({ where: { abbreviation: "TDA" } })).toBeNull();
  });

  it("login uses generic errors, locks after repeated failures and records attempts", async () => {
    const bad = await login("nobody@test.invalid", "whatever");
    const wrong = await login("rep@tmo.test.invalid", "Wrong-Passw0rd-1");
    expect(bad).toEqual(wrong);
    for (let i = 0; i < 4; i++) await login("rep@tmo.test.invalid", "Wrong-Passw0rd-1");
    const locked = await login("rep@tmo.test.invalid", "Strong-Passw0rd-1");
    expect(locked.ok).toBe(false);
    expect(await prisma.loginAttempt.count({ where: { email: "rep@tmo.test.invalid", success: false } })).toBeGreaterThanOrEqual(5);
    expect(await prisma.auditEvent.count({ where: { action: "auth.account_locked" } })).toBe(1);
    await prisma.user.update({ where: { email: "rep@tmo.test.invalid" }, data: { lockedUntil: null } });
  });

  it("successful login issues a fresh hashed session token", async () => {
    const r = await login("rep@tmo.test.invalid", "Strong-Passw0rd-1");
    if (!r.ok) throw new Error(r.error);
    const s = await validateSessionToken(r.token);
    expect(s?.userId).toBeTruthy();
    expect(await prisma.session.count({ where: { tokenHash: r.token } })).toBe(0); // never stored in clear
  });

  it("password reset is single-use and revokes sessions", async () => {
    const r = await login("rep@tmo.test.invalid", "Strong-Passw0rd-1");
    if (!r.ok) throw new Error(r.error);
    await requestPasswordReset("rep@tmo.test.invalid");
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "rep@tmo.test.invalid" } });
    const token = await issueToken(prisma, u.id, "PASSWORD_RESET");
    await expect(resetPassword(token, "short")).rejects.toThrow();
    await resetPassword(token, "Brand-New-Passw0rd");
    await expect(resetPassword(token, "Another-Passw0rd-9")).rejects.toThrow(/invalid or has expired/);
    expect(await validateSessionToken(r.token)).toBeNull();
    expect((await login("rep@tmo.test.invalid", "Brand-New-Passw0rd")).ok).toBe(true);
  });

  it("MFA enrolment and verification rotate the session", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const secret = await beginMfaEnrollment(admin);
    const enr = await confirmMfaEnrollment(admin, authenticator.generate(secret));
    expect(enr.recoveryCodes).toHaveLength(10);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.mfaSecretEnc).not.toContain(secret);
    expect(decrypt(stored.mfaSecretEnc!)).toBe(secret);
    const r = await login(stored.email, "Test-Passw0rd-123");
    if (!r.ok) throw new Error(r.error);
    expect(r.mfaRequired).toBe(true);
    const pending = await validateSessionToken(r.token);
    expect(pending?.mfaVerified).toBe(false);
    await expect(completeMfa(pending!.id, "000000")).rejects.toThrow();
    const fresh = await completeMfa(pending!.id, enr.recoveryCodes[0]);
    expect(await validateSessionToken(r.token)).toBeNull(); // old token revoked
    expect((await validateSessionToken(fresh.token))?.mfaVerified).toBe(true);
    const again = await login(stored.email, "Test-Passw0rd-123");
    if (!again.ok) throw new Error(again.error);
    const s2 = await validateSessionToken(again.token);
    await expect(completeMfa(s2!.id, enr.recoveryCodes[0])).rejects.toThrow(); // recovery codes are single-use
    void (await loadA(admin.id));
  });

  it("verified directory import validates before applying and allows claiming", async () => {
    const importer = await makeUser("OPERATIONS_ADMIN");
    const badCsv = "name,abbreviation,category\nX,BAD!,MINISTRY\nTEST Board,TB,NOT_A_CATEGORY\nTEST Board,TB,BOARD\nTEST Board,TB,BOARD\n";
    const plan = await planMdaImport(badCsv);
    expect(plan.errorCount).toBe(3);
    expect((await applyMdaImport(importer, badCsv)).applied).toBe(false);
    expect(await prisma.mda.count({ where: { status: "DIRECTORY" } })).toBe(0);
    const good = "name,abbreviation,category,supervising_ministry_abbreviation\nTEST Ministry of Records,TMR,MINISTRY,\nTEST Records Agency,TRA,AGENCY,TMR\n";
    const res = await applyMdaImport(importer, good);
    expect(res.applied).toBe(true);
    const agency = await prisma.mda.findUniqueOrThrow({ where: { abbreviation: "TRA" }, include: { supervisingMinistry: true } });
    expect(agency.status).toBe("DIRECTORY");
    expect(agency.isDirectoryVerified).toBe(true);
    expect(agency.supervisingMinistry?.abbreviation).toBe("TMR");
    await registerMda(reg("rep@tra.test.invalid", "Anything typed", "ZZZ", agency.id));
    const claimed = await prisma.mda.findUniqueOrThrow({ where: { id: agency.id } });
    expect(claimed.status).toBe("PENDING_REVIEW");
    expect(claimed.name).toBe("TEST Records Agency"); // directory name is authoritative
    await expect(registerMda(reg("second@tra.test.invalid", "Another typed name", "YYY", agency.id))).rejects.toThrow(/already been registered/);
  });
});
