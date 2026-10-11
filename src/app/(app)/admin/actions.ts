"use server";

import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { requireActor } from "@/modules/auth/current";
import { assertCan } from "@/modules/rbac/authorize";
import { setRolePermissions, setUserRoles, setUserStatus, updateStaffProfile, upsertDepartment } from "@/modules/admin/users";
import { savePolicy, upsertCategory, upsertService } from "@/modules/admin/catalog";
import { updateSetting } from "@/modules/settings/service";
import { processOutbox, retryOutboxEvent } from "@/modules/notifications/service";
import { verifyAuditChain } from "@/modules/audit/audit";

export async function userRolesAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { await setUserRoles(await requireActor(), str(fd, "userId")!, fd.getAll("roleKeys").map(String)); return "Roles updated; the user's sessions were revoked so new privileges apply at next sign-in."; });
  revalidatePath("/admin/users");
  return res;
}

export async function userStatusAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { await setUserStatus(await requireActor(), str(fd, "userId")!, str(fd, "status") as "ACTIVE", str(fd, "reason") ?? ""); return "Account status updated."; });
  revalidatePath("/admin/users");
  return res;
}

export async function staffProfileAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { await updateStaffProfile(await requireActor(), str(fd, "userId")!, { departmentId: str(fd, "departmentId"), skills: str(fd, "skills"), maxConcurrentProjects: str(fd, "maxConcurrentProjects"), availabilityNote: str(fd, "availabilityNote") }); return "Staff profile updated."; });
  revalidatePath("/admin/users");
  return res;
}

export async function rolePermissionsAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { await setRolePermissions(await requireActor(), str(fd, "roleId")!, fd.getAll("permissions").map(String)); return "Role permissions saved."; });
  revalidatePath("/admin/roles");
  return res;
}

export async function departmentAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    await upsertDepartment(await requireActor(), str(fd, "id") || null, { code: str(fd, "code"), name: str(fd, "name"), description: str(fd, "description") || undefined, headId: str(fd, "headId"), active: fd.get("active") === "on" });
    return "Department saved.";
  });
  revalidatePath("/admin/departments");
  return res;
}

export async function categoryAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    await upsertCategory(await requireActor(), str(fd, "id") || null, { code: str(fd, "code"), name: str(fd, "name"), description: str(fd, "description") || undefined, sortOrder: str(fd, "sortOrder") || 0, slaTriageHours: str(fd, "slaTriageHours"), slaAssessmentDays: str(fd, "slaAssessmentDays"), slaDeliveryDays: str(fd, "slaDeliveryDays"), active: fd.get("active") === "on" });
    return "Category saved.";
  });
  revalidatePath("/admin/catalog");
  return res;
}

const SERVICE_FIELDS = ["categoryId", "code", "name", "description", "eligibility", "requiredInformation", "requiredAttachments", "estimatedMinDays", "estimatedMaxDays", "assessmentChecklist", "defaultPriority", "priorityRules", "approvalPolicyId", "suggestedDepartmentId", "standardDeliverables", "slaTriageHours", "slaAssessmentDays", "slaDeliveryDays"];

export async function serviceAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    await upsertService(await requireActor(), str(fd, "id") || null, { ...Object.fromEntries(SERVICE_FIELDS.map((k) => [k, str(fd, k) ?? ""])), active: fd.get("active") === "on" });
    return "Service saved.";
  });
  revalidatePath("/admin/catalog");
  return res;
}

export async function policyAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    const steps = [0, 1, 2, 3, 4].map((i) => ({
      name: str(fd, `step${i}.name`), requiredPermission: str(fd, `step${i}.permission`), minPriority: str(fd, `step${i}.minPriority`),
      minEstimatedCostNgn: str(fd, `step${i}.minCost`), minEstimatedEffortDays: str(fd, `step${i}.minEffort`),
    })).filter((s) => s.name);
    await savePolicy(await requireActor(), str(fd, "id") || null, { name: str(fd, "name"), description: str(fd, "description") || undefined, isDefault: fd.get("isDefault") === "on", steps });
    return "Approval policy saved.";
  });
  revalidatePath("/admin/catalog");
  return res;
}

export async function settingAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    const key = str(fd, "key")!;
    const kind = str(fd, "kind");
    let value: unknown;
    const raw = str(fd, "value") ?? "";
    if (kind === "boolean") value = fd.get("value") === "on";
    else if (kind === "number") value = Number(raw);
    else if (kind === "string") value = raw;
    else {
      try { value = JSON.parse(raw); } catch { throw new AppError("Value must be valid JSON."); }
    }
    await updateSetting(await requireActor(), key, value);
    return `Setting ${key} saved.`;
  });
  revalidatePath("/admin/settings");
  return res;
}

export async function processOutboxAction(): Promise<ActionState> {
  const res = await runAction(async () => {
    assertCan(await requireActor(), "system.notifications.manage");
    const r = await processOutbox(50);
    return `Delivery run complete: ${r.sent} sent, ${r.failed} failed.`;
  });
  revalidatePath("/admin/outbox");
  return res;
}

export async function retryOutboxAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { assertCan(await requireActor(), "system.notifications.manage"); await retryOutboxEvent(str(fd, "id")!); return "Queued for retry."; });
  revalidatePath("/admin/outbox");
  return res;
}

export async function verifyChainAction(): Promise<ActionState> {
  return runAction(async () => {
    assertCan(await requireActor(), "audit.read");
    const r = await verifyAuditChain();
    return r.ok ? `Integrity check passed: ${r.checked} audit events verified.` : `INTEGRITY FAILURE at event ${r.firstBrokenId}: ${r.reason}`;
  });
}
