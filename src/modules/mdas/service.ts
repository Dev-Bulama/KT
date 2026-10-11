import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { randomToken, sha256 } from "@/lib/crypto";
import { audit } from "@/modules/audit/audit";
import { enqueueEmail, mdaAdminIds, notify } from "@/modules/notifications/service";
import { renderEmailHtml } from "@/modules/notifications/email";
import { hashPassword, passwordSchema } from "@/modules/auth/password";
import { sendVerificationEmail } from "@/modules/auth/service";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan, can } from "@/modules/rbac/authorize";
import { mdaScope } from "@/modules/rbac/scope";
import { mdaProfileSchema, registrationSchema, type MdaProfileInput } from "./schemas";

const REGISTRATION_ACK =
  "Thank you. If the details can be registered, a verification email has been sent. Verify your email to submit your MDA profile for KATDICT review.";

// ---------------------------------------------------------------------------
// Registration (public)
// ---------------------------------------------------------------------------

export async function registerMda(raw: unknown, client: { ip?: string | null } = {}): Promise<{ message: string }> {
  await enforceRateLimit(`register:${client.ip ?? "unknown"}`, 5, 3600, "Too many registrations from this network. Try again later.");
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  const pw = passwordSchema.safeParse(parsed.data.representative.password);
  if (!pw.success) throw new ValidationError(pw.error.issues[0].message, { password: [pw.error.issues[0].message] });
  const { representative: rep, profile, claimMdaId } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email: rep.email } });
  if (existingUser) {
    // Avoid account enumeration: same response; notify the real owner.
    await enqueueEmail(prisma, {
      to: rep.email,
      subject: "[KATDICT] Registration attempt",
      text: `Someone attempted to register an MDA account using this email address. If this was you, sign in or reset your password instead. If not, no action is needed.`,
      html: renderEmailHtml("Registration attempt", "Someone attempted to register an MDA account using this email address. If this was you, sign in or reset your password instead."),
    });
    return { message: REGISTRATION_ACK };
  }

  const passwordHash = await hashPassword(pw.data);
  const mdaAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: "MDA_ADMIN" } });

  const userId = await prisma.$transaction(async (tx) => {
    let mdaId: string;
    if (claimMdaId) {
      const target = await tx.mda.findUnique({ where: { id: claimMdaId } });
      if (!target || target.status !== "DIRECTORY") {
        throw new AppError("This MDA has already been registered or is not available for claiming. Ask its MDA administrator for an invitation.");
      }
      // Claimed: profile becomes the submitted profile; directory name/abbreviation are authoritative.
      const updated = await tx.mda.updateMany({
        where: { id: target.id, status: "DIRECTORY" },
        data: { ...profileData(profile), name: target.name, abbreviation: target.abbreviation, status: "PENDING_REVIEW" },
      });
      if (updated.count !== 1) throw new ConflictError("This MDA was claimed by someone else moments ago.");
      mdaId = target.id;
    } else {
      const clash = await tx.mda.findFirst({
        where: { OR: [{ name: { equals: profile.name, mode: "insensitive" } }, { abbreviation: profile.abbreviation }] },
      });
      if (clash) {
        throw new AppError(
          clash.status === "DIRECTORY"
            ? "This MDA exists in the verified directory. Select it from the directory list to claim it."
            : "An MDA with this name or abbreviation is already registered. Ask its administrator for an invitation.",
        );
      }
      const mda = await tx.mda.create({ data: { ...profileData(profile), status: "PENDING_REVIEW" } });
      mdaId = mda.id;
    }
    const user = await tx.user.create({
      data: {
        email: rep.email, name: rep.name, phone: rep.phone, designation: rep.designation, passwordHash,
        userType: "MDA_USER", status: "PENDING_VERIFICATION",
        roles: { create: { roleId: mdaAdminRole.id } },
        membership: { create: { mdaId, isPrimaryRepresentative: true } },
      },
    });
    await tx.mda.update({ where: { id: mdaId }, data: { registeredById: user.id } });
    await audit(tx, {
      actorId: user.id, actorEmail: user.email, action: claimMdaId ? "mda.claimed" : "mda.registered",
      entityType: "Mda", entityId: mdaId, after: { name: profile.name, abbreviation: profile.abbreviation },
    });
    return user.id;
  });
  await sendVerificationEmail(userId);
  return { message: REGISTRATION_ACK };
}

function profileData(p: MdaProfileInput) {
  return {
    name: p.name,
    abbreviation: p.abbreviation,
    category: p.category,
    supervisingMinistryId: p.supervisingMinistryId ?? null,
    address: p.address,
    officialEmail: p.officialEmail,
    officialPhone: p.officialPhone,
    contactPersonName: p.contactPersonName,
    contactPersonDesignation: p.contactPersonDesignation,
    ictContactName: p.ictContactName ?? null,
    ictContactEmail: p.ictContactEmail ?? null,
    ictContactPhone: p.ictContactPhone ?? null,
    website: p.website ?? null,
    description: p.description ?? null,
  };
}

// ---------------------------------------------------------------------------
// Directory and profile
// ---------------------------------------------------------------------------

export async function listMdas(
  actor: Actor,
  opts: { q?: string; status?: string; category?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 25);
  const where: Prisma.MdaWhereInput = {
    AND: [
      mdaScope(actor),
      opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { abbreviation: { contains: opts.q, mode: "insensitive" } }] } : {},
      opts.status ? { status: opts.status as never } : {},
      opts.category ? { category: opts.category as never } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.mda.findMany({
      where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, name: true, abbreviation: true, category: true, status: true, isDirectoryVerified: true, submittedAt: true,
        _count: { select: { requests: true, projects: true, members: true } },
      },
    }),
    prisma.mda.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/** Public list of verified directory entries available for claiming at registration. */
export async function listClaimableMdas() {
  return prisma.mda.findMany({ where: { status: "DIRECTORY" }, select: { id: true, name: true, abbreviation: true, category: true }, orderBy: { name: "asc" } });
}

export async function getMda(actor: Actor, id: string) {
  const mda = await prisma.mda.findFirst({
    where: { AND: [{ id }, mdaScope(actor)] },
    include: {
      supervisingMinistry: { select: { id: true, name: true } },
      registeredBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true, status: true, designation: true, roles: { include: { role: true } } } } } },
      invitations: { where: { acceptedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!mda) throw new NotFoundError();
  const showMembers = can(actor, "mda.read.all") || actor.mdaId === mda.id;
  return { ...mda, members: showMembers ? mda.members : [], invitations: can(actor, "mda.users.manage.own") && actor.mdaId === mda.id ? mda.invitations : [] };
}

export async function updateMdaProfile(actor: Actor, mdaId: string, raw: unknown, expectedVersion: number) {
  const isOwn = actor.mdaId === mdaId && can(actor, "mda.profile.edit.own");
  if (!isOwn && !can(actor, "mda.manage")) throw new ForbiddenError();
  const parsed = mdaProfileSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  return prisma.$transaction(async (tx) => {
    const before = await tx.mda.findUniqueOrThrow({ where: { id: mdaId } });
    const data = profileData(parsed.data);
    // MDA users may not rename a directory-verified MDA (prevents impersonation).
    if (isOwn && before.isDirectoryVerified && !can(actor, "mda.manage")) {
      data.name = before.name;
      data.abbreviation = before.abbreviation;
    }
    const resubmit = isOwn && before.status === "CHANGES_REQUESTED";
    const res = await tx.mda.updateMany({
      where: { id: mdaId, version: expectedVersion },
      data: { ...data, version: { increment: 1 }, ...(resubmit ? { status: "PENDING_REVIEW", submittedAt: new Date() } : {}) },
    });
    if (res.count !== 1) throw new ConflictError();
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: resubmit ? "mda.profile_resubmitted" : "mda.profile_updated",
      entityType: "Mda", entityId: mdaId, before: profileSnapshot(before), after: data,
    });
    return { resubmitted: resubmit };
  });
}

function profileSnapshot(m: Record<string, unknown>) {
  const keys = ["name", "abbreviation", "category", "address", "officialEmail", "officialPhone", "contactPersonName", "contactPersonDesignation", "ictContactName", "ictContactEmail", "ictContactPhone", "website", "status"];
  return Object.fromEntries(keys.map((k) => [k, m[k] ?? null]));
}

// ---------------------------------------------------------------------------
// KATDICT review lifecycle
// ---------------------------------------------------------------------------

export type MdaReviewDecision = "APPROVE" | "REJECT" | "REQUEST_CHANGES";

export async function reviewMda(actor: Actor, mdaId: string, decision: MdaReviewDecision, notes: string | undefined, expectedVersion: number) {
  assertCan(actor, "mda.review");
  if ((decision === "REJECT" || decision === "REQUEST_CHANGES") && !notes?.trim()) {
    throw new ValidationError("A reason is required for this decision.");
  }
  const target = { APPROVE: "APPROVED", REJECT: "REJECTED", REQUEST_CHANGES: "CHANGES_REQUESTED" } as const;
  await prisma.$transaction(async (tx) => {
    const mda = await tx.mda.findUniqueOrThrow({ where: { id: mdaId } });
    if (mda.status !== "PENDING_REVIEW" || !mda.submittedAt) throw new AppError("Only submitted registrations awaiting review can be decided.");
    const now = new Date();
    const res = await tx.mda.updateMany({
      where: { id: mdaId, version: expectedVersion, status: "PENDING_REVIEW" },
      data: {
        status: target[decision], reviewedById: actor.id, reviewedAt: now, reviewNotes: notes?.trim() || null,
        ...(decision === "APPROVE" ? { approvedAt: now } : {}), version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw new ConflictError();
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: `mda.review.${decision.toLowerCase()}`, entityType: "Mda", entityId: mdaId,
      before: { status: mda.status }, after: { status: target[decision] }, reason: notes,
    });
    const admins = await tx.user.findMany({ where: { membership: { mdaId } }, select: { id: true } });
    const ids = admins.map((a) => a.id);
    if (decision === "APPROVE") {
      await notify(tx, { userIds: ids, type: "mda.registration_approved", title: "MDA registration approved", body: `${mda.name} has been approved by KATDICT. Sign in to activate your institutional account.`, link: "/my-mda" });
    } else if (decision === "REJECT") {
      await notify(tx, { userIds: ids, type: "mda.registration_rejected", title: "MDA registration not approved", body: `KATDICT could not approve the registration of ${mda.name}.\n\nReason: ${notes}`, link: "/my-mda" });
    } else {
      await notify(tx, { userIds: ids, type: "mda.changes_requested", title: "Corrections requested for your MDA registration", body: `KATDICT has requested corrections:\n\n${notes}\n\nUpdate your profile to resubmit.`, link: "/my-mda" });
    }
  });
}

/** Step 7: the MDA administrator activates the approved institutional account. */
export async function activateMda(actor: Actor) {
  if (!actor.mdaId || !actor.roles.includes("MDA_ADMIN")) throw new ForbiddenError();
  await prisma.$transaction(async (tx) => {
    const res = await tx.mda.updateMany({ where: { id: actor.mdaId!, status: "APPROVED" }, data: { status: "ACTIVE", activatedAt: new Date(), version: { increment: 1 } } });
    if (res.count !== 1) throw new AppError("The MDA must be approved by KATDICT before it can be activated.");
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "mda.activated", entityType: "Mda", entityId: actor.mdaId, after: { status: "ACTIVE" } });
  });
}

export async function setMdaSuspension(actor: Actor, mdaId: string, suspend: boolean, reason: string) {
  assertCan(actor, "mda.manage");
  if (!reason?.trim()) throw new ValidationError("A reason is required.");
  await prisma.$transaction(async (tx) => {
    const mda = await tx.mda.findUniqueOrThrow({ where: { id: mdaId } });
    if (suspend && mda.status !== "ACTIVE") throw new AppError("Only active MDAs can be suspended.");
    if (!suspend && mda.status !== "SUSPENDED") throw new AppError("Only suspended MDAs can be reactivated.");
    await tx.mda.update({
      where: { id: mdaId },
      data: suspend
        ? { status: "SUSPENDED", suspendedAt: new Date(), suspensionReason: reason, version: { increment: 1 } }
        : { status: "ACTIVE", suspendedAt: null, suspensionReason: null, version: { increment: 1 } },
    });
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: suspend ? "mda.suspended" : "mda.reactivated", entityType: "Mda", entityId: mdaId,
      before: { status: mda.status }, after: { status: suspend ? "SUSPENDED" : "ACTIVE" }, reason,
    });
    await notify(tx, {
      userIds: await mdaAdminIds(tx, mdaId), type: "mda.status_changed",
      title: suspend ? "MDA account suspended" : "MDA account reactivated",
      body: suspend ? `${mda.name} has been suspended. Reason: ${reason}` : `${mda.name} has been reactivated.`,
    });
  });
}

export async function setStaffSubmissionPolicy(actor: Actor, allowed: boolean) {
  if (!actor.mdaId || !can(actor, "mda.users.manage.own")) throw new ForbiddenError();
  await prisma.mda.update({ where: { id: actor.mdaId }, data: { staffMaySubmit: allowed } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "mda.policy_updated", entityType: "Mda", entityId: actor.mdaId, after: { staffMaySubmit: allowed } });
}

// ---------------------------------------------------------------------------
// Invitations (MDA staff and KATDICT staff)
// ---------------------------------------------------------------------------

const INVITE_DAYS = 7;

export async function createInvitation(
  actor: Actor,
  input: { email: string; name?: string; roleKeys: string[]; mdaId?: string | null; departmentId?: string | null },
) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  if (!input.roleKeys.length) throw new ValidationError("Select at least one role.");
  const roles = await prisma.role.findMany({ where: { key: { in: input.roleKeys } } });
  if (roles.length !== input.roleKeys.length) throw new ValidationError("Unknown role.");

  const userTypes = new Set(roles.map((r) => r.userType));
  if (userTypes.size !== 1) throw new ValidationError("Roles for different user types cannot be combined.");
  const userType = [...userTypes][0];

  if (userType === "MDA_USER") {
    const mdaId = input.mdaId ?? actor.mdaId;
    const ownMda = actor.mdaId && mdaId === actor.mdaId && can(actor, "mda.users.manage.own");
    if (!ownMda && !can(actor, "mda.manage")) throw new ForbiddenError("You can only invite users to your own MDA.");
    input.mdaId = mdaId;
    const mda = await prisma.mda.findUnique({ where: { id: mdaId! } });
    if (!mda || mda.status !== "ACTIVE") throw new AppError("Invitations can only be sent for active MDAs.");
  } else {
    assertCan(actor, "user.manage");
    assertCan(actor, "role.assign");
    if (input.roleKeys.includes("SUPER_ADMIN") && !actor.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenError("Only a Super Administrator can invite another Super Administrator.");
    }
    input.mdaId = null;
  }
  if (await prisma.user.findUnique({ where: { email } })) throw new AppError("An account with this email already exists.");

  const token = randomToken(32);
  const inv = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({ where: { email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const created = await tx.invitation.create({
      data: {
        email, name: input.name?.trim() || null, roleKeys: input.roleKeys, mdaId: input.mdaId ?? null,
        departmentId: input.departmentId ?? null, tokenHash: sha256(token), invitedById: actor.id,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
      },
    });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "user.invited", entityType: "Invitation", entityId: created.id, after: { email, roleKeys: input.roleKeys, mdaId: input.mdaId } });
    const link = `${process.env.APP_URL ?? ""}/invite/${encodeURIComponent(token)}`;
    const body = `${actor.name} has invited you to the KATDICT Service & Project Intelligence Management Platform.\n\nAccept the invitation within ${INVITE_DAYS} days:\n${link}`;
    await enqueueEmail(tx, { to: email, subject: "[KATDICT] You have been invited", text: body, html: renderEmailHtml("Invitation to the KATDICT platform", body) });
    return created;
  });
  return { id: inv.id, devToken: process.env.NODE_ENV !== "production" ? token : undefined };
}

export async function revokeInvitation(actor: Actor, invitationId: string) {
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!inv) throw new NotFoundError();
  const allowed = (inv.mdaId && inv.mdaId === actor.mdaId && can(actor, "mda.users.manage.own")) || can(actor, "user.manage");
  if (!allowed) throw new ForbiddenError();
  await prisma.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "user.invitation_revoked", entityType: "Invitation", entityId: inv.id });
}

export async function getInvitationByToken(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { mda: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return { email: inv.email, name: inv.name, mdaName: inv.mda?.name ?? null, roleKeys: inv.roleKeys };
}

export async function acceptInvitation(token: string, input: { name: string; password: string; phone?: string; designation?: string }) {
  const pw = passwordSchema.safeParse(input.password);
  if (!pw.success) throw new ValidationError(pw.error.issues[0].message);
  if (!input.name?.trim() || input.name.trim().length < 3) throw new ValidationError("Enter your full name.");
  const passwordHash = await hashPassword(pw.data);
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new AppError("This invitation is invalid or has expired.");
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError("This invitation has already been used.");
    if (await tx.user.findUnique({ where: { email: inv.email } })) throw new AppError("An account with this email already exists.");
    const roles = await tx.role.findMany({ where: { key: { in: inv.roleKeys } } });
    const userType = roles[0]?.userType ?? "MDA_USER";
    const user = await tx.user.create({
      data: {
        email: inv.email, name: input.name.trim(), phone: input.phone?.trim() || null, designation: input.designation?.trim() || null,
        passwordHash, userType, status: "ACTIVE", emailVerifiedAt: new Date(), departmentId: inv.departmentId,
        roles: { create: roles.map((r) => ({ roleId: r.id, grantedById: inv.invitedById })) },
        ...(inv.mdaId ? { membership: { create: { mdaId: inv.mdaId } } } : {}),
      },
    });
    await audit(tx, { actorId: user.id, actorEmail: user.email, action: "user.invitation_accepted", entityType: "User", entityId: user.id, after: { roleKeys: inv.roleKeys, mdaId: inv.mdaId } });
    return { userId: user.id };
  });
}

/** MDA admins can suspend/reactivate users of their own MDA (not themselves). */
export async function setMdaMemberStatus(actor: Actor, userId: string, active: boolean) {
  if (userId === actor.id) throw new AppError("You cannot change your own account status.");
  const member = await prisma.mdaMembership.findUnique({ where: { userId } });
  if (!member) throw new NotFoundError();
  const own = member.mdaId === actor.mdaId && can(actor, "mda.users.manage.own");
  if (!own && !can(actor, "mda.manage")) throw new ForbiddenError();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: active ? "ACTIVE" : "SUSPENDED" } });
    if (!active) await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: active ? "user.reactivated" : "user.suspended", entityType: "User", entityId: userId });
  });
}

/** Change of authorised representative: transfers the primary-representative flag. */
export async function transferPrimaryRepresentative(actor: Actor, newUserId: string) {
  if (!actor.mdaId) throw new ForbiddenError();
  const membership = await prisma.mdaMembership.findUnique({ where: { userId: newUserId }, include: { user: { include: { roles: { include: { role: true } } } } } });
  if (!membership || membership.mdaId !== actor.mdaId) throw new NotFoundError();
  const current = await prisma.mdaMembership.findFirst({ where: { mdaId: actor.mdaId, isPrimaryRepresentative: true } });
  if (current?.userId !== actor.id && !can(actor, "mda.manage")) throw new ForbiddenError("Only the current primary representative can transfer this role.");
  if (!membership.user.roles.some((r) => r.role.key === "MDA_ADMIN")) throw new AppError("The new representative must hold the MDA Administrator role.");
  await prisma.$transaction(async (tx) => {
    await tx.mdaMembership.updateMany({ where: { mdaId: actor.mdaId! }, data: { isPrimaryRepresentative: false } });
    await tx.mdaMembership.update({ where: { userId: newUserId }, data: { isPrimaryRepresentative: true } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "mda.representative_changed", entityType: "Mda", entityId: actor.mdaId, before: { userId: current?.userId }, after: { userId: newUserId } });
  });
}
