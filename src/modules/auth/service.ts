import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sha256 } from "@/lib/crypto";
import { audit } from "@/modules/audit/audit";
import { enqueueEmail, notify, usersWithPermission } from "@/modules/notifications/service";
import { renderEmailHtml } from "@/modules/notifications/email";
import { getSetting } from "@/modules/settings/service";
import { hashPassword, passwordSchema, verifyPassword } from "./password";
import { createSession, revokeAllUserSessions, revokeSession } from "./session";
import { consumeToken, issueToken } from "./tokens";
import { generateMfaSecret, generateRecoveryCodes, verifyTotp } from "./mfa";
import type { Actor } from "@/modules/rbac/actor";

const GENERIC_LOGIN_ERROR = "The email or password is incorrect, or the account is temporarily locked.";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; mfaRequired: boolean; userId: string }
  | { ok: false; error: string; needsVerification?: boolean };

export async function login(emailInput: string, password: string, client: ClientInfo = {}): Promise<LoginResult> {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success || !password) return { ok: false, error: GENERIC_LOGIN_ERROR };

  await enforceRateLimit(`login:ip:${client.ip ?? "unknown"}`, 30, 600);
  await enforceRateLimit(`login:email:${email.data}`, 10, 900);

  const user = await prisma.user.findUnique({ where: { email: email.data } });
  const record = (success: boolean, reason: string) =>
    prisma.loginAttempt.create({ data: { email: email.data, ip: client.ip ?? null, success, reason } });

  const valid = await verifyPassword(user?.passwordHash, password);
  if (!user) {
    await record(false, "unknown_account");
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await record(false, "locked");
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }
  if (!valid) {
    const max = await getSetting("security.maxFailedLogins");
    const lockMinutes = await getSetting("security.lockoutMinutes");
    const failed = user.failedLoginCount + 1;
    const lock = failed >= max;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + lockMinutes * 60_000) : null },
    });
    await record(false, lock ? "bad_password_locked" : "bad_password");
    if (lock) {
      await audit(null, { actorId: user.id, actorEmail: user.email, action: "auth.account_locked", entityType: "User", entityId: user.id });
    }
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }
  if (user.status === "PENDING_VERIFICATION") {
    await record(false, "unverified");
    return { ok: false, error: "Please verify your email address first. Check your inbox for the verification link.", needsVerification: true };
  }
  if (user.status !== "ACTIVE") {
    await record(false, `status_${user.status.toLowerCase()}`);
    return { ok: false, error: "This account is not active. Contact KATDICT support." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  // A brand-new session token is always issued on login (prevents session fixation).
  const session = await createSession(user.id, { mfaVerified: !user.mfaEnabled, ...client });
  await record(true, user.mfaEnabled ? "password_ok_mfa_pending" : "ok");
  await audit(null, { actorId: user.id, actorEmail: user.email, action: "auth.login", entityType: "User", entityId: user.id });
  return { ok: true, token: session.token, expiresAt: session.expiresAt, mfaRequired: user.mfaEnabled, userId: user.id };
}

export async function logout(actor: Actor | null, sessionId: string | null) {
  if (sessionId) await revokeSession(sessionId);
  if (actor) await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "auth.logout", entityType: "User", entityId: actor.id });
}

// ---------------------------------------------------------------------------
// MFA
// ---------------------------------------------------------------------------

/** Completes the MFA step: verifies code (or recovery code) and rotates the session. */
export async function completeMfa(sessionId: string, code: string, client: ClientInfo = {}) {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) throw new AppError("Your session has expired. Sign in again.");
  await enforceRateLimit(`mfa:${session.userId}`, 8, 600, "Too many verification attempts. Wait 10 minutes.");
  const user = session.user;
  if (!user.mfaEnabled || !user.mfaSecretEnc) throw new AppError("MFA is not enabled for this account.");

  let ok = verifyTotp(user.mfaSecretEnc, code);
  let usedRecovery = false;
  if (!ok) {
    const h = sha256(code.trim().toUpperCase());
    if (user.mfaRecoveryHashes.includes(h)) {
      ok = true;
      usedRecovery = true;
      await prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((x) => x !== h) } });
    }
  }
  if (!ok) {
    await audit(null, { actorId: user.id, actorEmail: user.email, action: "auth.mfa_failed", entityType: "User", entityId: user.id });
    throw new AppError("The verification code is not valid.");
  }
  await revokeSession(session.id);
  const fresh = await createSession(user.id, { mfaVerified: true, ...client });
  await audit(null, {
    actorId: user.id, actorEmail: user.email, action: usedRecovery ? "auth.mfa_recovery_code_used" : "auth.mfa_verified",
    entityType: "User", entityId: user.id,
  });
  if (usedRecovery) {
    await notify(prisma, { userIds: [user.id], type: "account.security", title: "Recovery code used", body: "A one-time MFA recovery code was used to sign in to your account. If this was not you, contact KATDICT immediately." });
  }
  return fresh;
}

export async function beginMfaEnrollment(actor: Actor) {
  const { secret, encrypted } = generateMfaSecret();
  await prisma.user.update({ where: { id: actor.id }, data: { mfaSecretEnc: encrypted, mfaEnabled: false } });
  return secret;
}

export async function confirmMfaEnrollment(actor: Actor, code: string, client: ClientInfo = {}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!user.mfaSecretEnc) throw new AppError("Start MFA setup first.");
  if (!verifyTotp(user.mfaSecretEnc, code)) throw new AppError("The verification code is not valid. Check your device clock and try again.");
  const { codes, hashes } = generateRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaRecoveryHashes: hashes } });
  if (actor.sessionId) await revokeSession(actor.sessionId);
  await revokeAllUserSessions(user.id);
  const fresh = await createSession(user.id, { mfaVerified: true, ...client });
  await audit(null, { actorId: user.id, actorEmail: user.email, action: "auth.mfa_enabled", entityType: "User", entityId: user.id });
  return { recoveryCodes: codes, session: fresh };
}

export async function disableMfa(actor: Actor, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(user.passwordHash, password))) throw new AppError("Password is incorrect.");
  if (actor.privileged && (await getSetting("security.requireMfaForPrivileged"))) {
    throw new ForbiddenError("MFA is mandatory for your role and cannot be disabled.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryHashes: [] } });
  await audit(null, { actorId: user.id, actorEmail: user.email, action: "auth.mfa_disabled", entityType: "User", entityId: user.id });
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await issueToken(prisma, user.id, "EMAIL_VERIFICATION");
  const link = `${process.env.APP_URL ?? ""}/verify-email?token=${encodeURIComponent(token)}`;
  const body = `Please confirm your email address to continue your KATDICT platform registration.\n\nThis link expires in 24 hours:\n${link}`;
  await enqueueEmail(prisma, {
    to: user.email,
    subject: "[KATDICT] Verify your email address",
    text: `Dear ${user.name},\n\n${body}`,
    html: renderEmailHtml("Verify your email address", `Dear ${user.name},\n\n${body}`),
  });
}

export async function resendVerification(emailInput: string, client: ClientInfo = {}) {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return;
  await enforceRateLimit(`verify-resend:${client.ip ?? "unknown"}`, 5, 900);
  const user = await prisma.user.findUnique({ where: { email: email.data } });
  if (user && user.status === "PENDING_VERIFICATION") await sendVerificationEmail(user.id);
}

/** Verifies email; for MDA registrants this also submits the MDA profile for KATDICT review. */
export async function verifyEmail(token: string): Promise<{ ok: boolean; message: string }> {
  return prisma.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, "EMAIL_VERIFICATION");
    if (!userId) return { ok: false, message: "This verification link is invalid or has expired." };
    const user = await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), status: "ACTIVE" },
      include: { membership: { include: { mda: true } } },
    });
    await audit(tx, { actorId: user.id, actorEmail: user.email, action: "auth.email_verified", entityType: "User", entityId: user.id });
    const mda = user.membership?.mda;
    if (mda && mda.registeredById === user.id && mda.status === "PENDING_REVIEW" && !mda.submittedAt) {
      await tx.mda.update({ where: { id: mda.id }, data: { submittedAt: new Date() } });
      await audit(tx, { actorId: user.id, actorEmail: user.email, action: "mda.registration_submitted", entityType: "Mda", entityId: mda.id, after: { name: mda.name } });
      const reviewers = await usersWithPermission(tx, "mda.review");
      await notify(tx, {
        userIds: reviewers, type: "mda.registration_received", title: `MDA registration received: ${mda.name}`,
        body: `${mda.name} (${mda.abbreviation}) has submitted its institutional profile for review.`, link: `/mdas/${mda.id}`,
      });
      return { ok: true, message: "Email verified. Your MDA registration has been submitted to KATDICT for review. You can sign in to track its status." };
    }
    return { ok: true, message: "Email verified. You can now sign in." };
  });
}

// ---------------------------------------------------------------------------
// Password reset / change
// ---------------------------------------------------------------------------

export async function requestPasswordReset(emailInput: string, client: ClientInfo = {}) {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return;
  await enforceRateLimit(`pwreset:ip:${client.ip ?? "unknown"}`, 10, 900);
  await enforceRateLimit(`pwreset:email:${email.data}`, 3, 900);
  const user = await prisma.user.findUnique({ where: { email: email.data } });
  if (!user || user.status !== "ACTIVE") return; // identical response either way
  const token = await issueToken(prisma, user.id, "PASSWORD_RESET");
  const link = `${process.env.APP_URL ?? ""}/reset-password?token=${encodeURIComponent(token)}`;
  const body = `A password reset was requested for your account. If you made this request, use the link below within 60 minutes:\n${link}\n\nIf you did not request this, ignore this email; your password will not change.`;
  await enqueueEmail(prisma, {
    to: user.email, subject: "[KATDICT] Password reset", text: `Dear ${user.name},\n\n${body}`,
    html: renderEmailHtml("Password reset", `Dear ${user.name},\n\n${body}`),
  });
  await audit(null, { actorId: user.id, actorEmail: user.email, action: "auth.password_reset_requested", entityType: "User", entityId: user.id });
}

export async function resetPassword(token: string, newPassword: string) {
  const pw = passwordSchema.safeParse(newPassword);
  if (!pw.success) throw new ValidationError(pw.error.issues[0].message, { password: pw.error.issues.map((i) => i.message) });
  const passwordHash = await hashPassword(pw.data);
  await prisma.$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, "PASSWORD_RESET");
    if (!userId) throw new AppError("This reset link is invalid or has expired. Request a new one.");
    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: user.id, actorEmail: user.email, action: "auth.password_reset", entityType: "User", entityId: user.id });
    await notify(tx, { userIds: [user.id], type: "account.security", title: "Your password was changed", body: "Your password was reset and all active sessions were signed out. If this was not you, contact KATDICT immediately." });
  });
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(user.passwordHash, current))) throw new AppError("Current password is incorrect.");
  const pw = passwordSchema.safeParse(next);
  if (!pw.success) throw new ValidationError(pw.error.issues[0].message);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw.data), passwordChangedAt: new Date() } });
  await revokeAllUserSessions(user.id, actor.sessionId ?? undefined);
  await audit(null, { actorId: user.id, actorEmail: user.email, action: "auth.password_changed", entityType: "User", entityId: user.id });
}

export async function listSessions(actor: Actor) {
  return prisma.session.findMany({
    where: { userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true, mfaVerified: true },
    orderBy: { lastSeenAt: "desc" },
  });
}

export async function revokeOwnSession(actor: Actor, sessionId: string) {
  const s = await prisma.session.findFirst({ where: { id: sessionId, userId: actor.id } });
  if (!s) throw new ForbiddenError();
  await revokeSession(s.id);
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "auth.session_revoked", entityType: "Session", entityId: s.id });
}
