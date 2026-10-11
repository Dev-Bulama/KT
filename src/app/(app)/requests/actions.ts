"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, str, num, type ActionState } from "@/lib/action";
import { requireActor } from "@/modules/auth/current";
import {
  addRequestComment, createDraft, decideApproval, deleteDraft, recordAssessment, submitRequest, transitionRequest, updateDraft,
} from "@/modules/requests/service";
import { initiateProject } from "@/modules/projects/service";
import { assessRequestQuality, classifyRequest } from "@/modules/ai/features";
import { AppError } from "@/lib/errors";

const DRAFT_FIELDS = [
  "serviceId", "title", "problemStatement", "currentSituation", "desiredOutcome", "businessJustification", "expectedBeneficiaries", "estimatedUsers",
  "urgency", "preferredCompletionDate", "existingSystems", "technicalInformation", "knownDependencies", "expectedDeliverables", "successCriteria",
  "institutionalImpact", "operationalUrgency", "legalConsiderations", "consequencesOfInaction",
];

/** Wizard save (create or update draft). Returns the draft id and version for autosave. */
export async function saveDraftAction(input: Record<string, unknown>): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const data = Object.fromEntries(DRAFT_FIELDS.map((k) => [k, input[k] === "" ? undefined : input[k]]));
    const id = typeof input.id === "string" && input.id ? input.id : null;
    const d = id ? await updateDraft(actor, id, data, Number(input.version ?? 0)) : await createDraft(actor, data);
    return { message: "Draft saved.", data: { id: d.id, version: d.version } };
  });
}

export async function submitDraftAction(id: string, submissionKey: string): Promise<ActionState> {
  const res = await runAction(async () => {
    const actor = await requireActor();
    const r = await submitRequest(actor, id, submissionKey);
    return { message: `Submitted as ${r.reference}.`, data: { id: r.id, reference: r.reference } };
  });
  if (res.ok) revalidatePath("/requests");
  return res;
}

export async function deleteDraftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    await deleteDraft(await requireActor(), str(fd, "id")!);
  });
  if (res.ok) redirect("/requests");
  return res;
}

export async function transitionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    const actor = await requireActor();
    const action = str(fd, "action")!;
    await transitionRequest(actor, id, action, {
      reason: str(fd, "reason"),
      triage: action === "accept_for_assessment" ? { priority: str(fd, "priority"), assignedDepartmentId: str(fd, "assignedDepartmentId"), assessorId: str(fd, "assessorId"), note: str(fd, "reason") } : undefined,
    }, num(fd, "version") ?? -1);
    return "Request updated.";
  });
  revalidatePath(`/requests/${id}`);
  return res;
}

export async function assessmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    const checklist: Record<string, boolean> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("check:")) checklist[k.slice(6)] = v === "on";
    await recordAssessment(await requireActor(), id, {
      stage: str(fd, "stage"), findings: str(fd, "findings"), recommendation: str(fd, "recommendation"), recommendedPriority: str(fd, "recommendedPriority"),
      estimatedEffortDays: str(fd, "estimatedEffortDays"), estimatedCostNgn: str(fd, "estimatedCostNgn"), proposedScope: str(fd, "proposedScope"), checklist,
    });
    return "Assessment recorded.";
  });
  revalidatePath(`/requests/${id}`);
  return res;
}

export async function approvalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    const outcome = str(fd, "outcome");
    if (!outcome || !["APPROVED", "REJECTED", "RETURNED"].includes(outcome)) throw new AppError("Choose a decision.");
    await decideApproval(await requireActor(), id, outcome as "APPROVED", str(fd, "reason"), num(fd, "version") ?? -1);
    return "Decision recorded.";
  });
  revalidatePath(`/requests/${id}`);
  revalidatePath("/approvals");
  return res;
}

export async function commentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    await addRequestComment(await requireActor(), id, str(fd, "body") ?? "", str(fd, "visibility") === "INTERNAL" ? "INTERNAL" : "MDA_VISIBLE");
    return "Message posted.";
  });
  revalidatePath(`/requests/${id}`);
  return res;
}

export async function initiateProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let projectId: string | null = null;
  const res = await runAction(async () => {
    const p = await initiateProject(await requireActor(), str(fd, "id")!, num(fd, "version") ?? -1);
    projectId = p.id;
  });
  if (res.ok && projectId) redirect(`/projects/${projectId}?tab=team`);
  return res;
}

export async function aiClassifyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const r = await classifyRequest(await requireActor(), str(fd, "id")!);
    return { message: r.notice ?? "Classification suggestion generated.", data: { result: r as unknown as Record<string, unknown> } };
  });
}

export async function aiQualityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const r = await assessRequestQuality(await requireActor(), str(fd, "id")!);
    return { message: r.notice ?? "Quality assessment generated.", data: { result: r as unknown as Record<string, unknown> } };
  });
}
