"use server";

import { revalidatePath } from "next/cache";
import { runAction, str, num, bool, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { requireActor } from "@/modules/auth/current";
import {
  activateMda, createInvitation, reviewMda, revokeInvitation, setMdaMemberStatus, setMdaSuspension, setStaffSubmissionPolicy, transferPrimaryRepresentative, updateMdaProfile,
} from "@/modules/mdas/service";
import { applyMdaImport, planMdaImport } from "@/modules/mdas/import";
import { assertCan } from "@/modules/rbac/authorize";

const PROFILE = ["name", "abbreviation", "category", "supervisingMinistryId", "address", "officialEmail", "officialPhone", "contactPersonName", "contactPersonDesignation", "ictContactName", "ictContactEmail", "ictContactPhone", "website", "description"];

export async function reviewMdaAction(_: ActionState, fd: FormData) {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    const d = str(fd, "decision");
    if (!d || !["APPROVE", "REJECT", "REQUEST_CHANGES"].includes(d)) throw new AppError("Choose a decision.");
    await reviewMda(await requireActor(), id, d as "APPROVE", str(fd, "notes"), num(fd, "version") ?? -1);
    return "Decision recorded and the MDA notified.";
  });
  revalidatePath(`/mdas/${id}`);
  return res;
}

export async function suspendMdaAction(_: ActionState, fd: FormData) {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    await setMdaSuspension(await requireActor(), id, str(fd, "mode") === "suspend", str(fd, "reason") ?? "");
    return "MDA status updated.";
  });
  revalidatePath(`/mdas/${id}`);
  return res;
}

export async function updateProfileAction(_: ActionState, fd: FormData) {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    const r = await updateMdaProfile(await requireActor(), id, Object.fromEntries(PROFILE.map((k) => [k, str(fd, k) ?? ""])), num(fd, "version") ?? -1);
    return r.resubmitted ? "Profile updated and resubmitted to KATDICT for review." : "Profile updated.";
  });
  revalidatePath("/my-mda");
  revalidatePath(`/mdas/${id}`);
  return res;
}

export async function activateMdaAction() {
  const res = await runAction(async () => {
    await activateMda(await requireActor());
    return "Your MDA account is now active. You can invite staff and submit requests.";
  });
  revalidatePath("/my-mda");
  return res;
}

export async function inviteAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    const r = await createInvitation(await requireActor(), { email: str(fd, "email") ?? "", name: str(fd, "name"), roleKeys: fd.getAll("roleKeys").map(String), mdaId: str(fd, "mdaId") || null, departmentId: str(fd, "departmentId") || null });
    return { message: "Invitation sent.", data: r.devToken ? { devLink: `/invite/${r.devToken}` } : undefined };
  });
  revalidatePath("/my-mda");
  revalidatePath("/admin/users");
  return res;
}

export async function revokeInviteAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { await revokeInvitation(await requireActor(), str(fd, "invitationId")!); return "Invitation revoked."; });
  revalidatePath("/my-mda");
  return res;
}

export async function memberStatusAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { await setMdaMemberStatus(await requireActor(), str(fd, "userId")!, str(fd, "active") === "true"); return "User updated."; });
  revalidatePath("/my-mda");
  return res;
}

export async function transferRepAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { await transferPrimaryRepresentative(await requireActor(), str(fd, "userId")!); return "Authorised representative changed."; });
  revalidatePath("/my-mda");
  return res;
}

export async function staffPolicyAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => { await setStaffSubmissionPolicy(await requireActor(), bool(fd, "allowed")); return "Policy saved."; });
  revalidatePath("/my-mda");
  return res;
}

export async function importPreviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    assertCan(actor, "mda.import");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a CSV file.");
    if (file.size > 2 * 1024 * 1024) throw new AppError("CSV must be under 2 MB.");
    const text = await file.text();
    const plan = await planMdaImport(text);
    const apply = str(fd, "apply") === "true";
    if (apply) {
      const r = await applyMdaImport(actor, text);
      if (!r.applied) throw new AppError("The file has errors; nothing was imported.");
      revalidatePath("/mdas");
      return { message: `Imported: ${plan.valid.filter((v) => v.action === "create").length} created, ${plan.valid.filter((v) => v.action === "update").length} updated.`, data: { plan: plan as unknown as Record<string, unknown> } };
    }
    return { message: plan.errorCount ? `${plan.errorCount} error(s) found. Fix the file and preview again.` : "Validation passed. Review the plan, then import.", data: { plan: plan as unknown as Record<string, unknown> } };
  });
}
