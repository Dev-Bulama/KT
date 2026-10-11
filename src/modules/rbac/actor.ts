import type { MdaStatus, UserStatus, UserType } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { PRIVILEGED_ROLE_KEYS, type Permission } from "./permissions";

/** The authenticated principal on whose behalf a service call runs. */
export interface Actor {
  id: string;
  email: string;
  name: string;
  userType: UserType;
  status: UserStatus;
  roles: string[];
  permissions: Set<string>;
  mdaId: string | null;
  mdaStatus: MdaStatus | null;
  mdaName: string | null;
  staffMaySubmit: boolean;
  departmentId: string | null;
  headOfDepartmentIds: string[];
  sessionId: string | null;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  privileged: boolean;
}

const PRE_ACTIVATION_MDA_PERMS: Permission[] = ["mda.profile.edit.own"];

/** Loads a user with roles/permissions and computes effective permissions. */
export async function loadActor(db: Db, userId: string, session?: { id: string; mfaVerified: boolean } | null): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      membership: { include: { mda: { select: { id: true, status: true, name: true, staffMaySubmit: true } } } },
      headOfDepartments: { select: { id: true } },
    },
  });
  if (!user || user.status !== "ACTIVE") return null;

  const roles = user.roles.map((r) => r.role.key);
  let permissions = new Set<string>();
  for (const ur of user.roles) {
    // Defence in depth: ignore roles whose userType does not match the user.
    if (ur.role.userType !== user.userType) continue;
    for (const rp of ur.role.permissions) permissions.add(rp.permission.key);
  }

  const mda = user.membership?.mda ?? null;
  if (user.userType === "MDA_USER") {
    if (!mda) permissions = new Set();
    else if (mda.status !== "ACTIVE") {
      const allowed = ["PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED"].includes(mda.status);
      permissions = new Set(allowed ? PRE_ACTIVATION_MDA_PERMS.filter((p) => permissions.has(p)) : []);
    }
  }

  const privileged = roles.some((r) => (PRIVILEGED_ROLE_KEYS as string[]).includes(r));
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    userType: user.userType,
    status: user.status,
    roles,
    permissions,
    mdaId: mda?.id ?? null,
    mdaStatus: mda?.status ?? null,
    mdaName: mda?.name ?? null,
    staffMaySubmit: mda?.staffMaySubmit ?? false,
    departmentId: user.departmentId,
    headOfDepartmentIds: user.headOfDepartments.map((d) => d.id),
    sessionId: session?.id ?? null,
    mfaEnabled: user.mfaEnabled,
    mfaVerified: session?.mfaVerified ?? false,
    privileged,
  };
}
