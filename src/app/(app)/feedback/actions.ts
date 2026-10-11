"use server";

import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { requireActor } from "@/modules/auth/current";
import { submitComplaint, updateComplaint } from "@/modules/feedback/service";

export async function complaintAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const ref = await submitComplaint(await requireActor(), { subject: str(fd, "subject"), description: str(fd, "description"), priority: str(fd, "priority"), projectId: str(fd, "projectId"), requestId: str(fd, "requestId") });
    return `Complaint ${ref} submitted. KATDICT has been notified.`;
  });
  revalidatePath("/feedback");
  return res;
}

export async function complaintUpdateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    const a = str(fd, "action");
    if (!a || !["REVIEW", "ESCALATE", "RESOLVE", "CLOSE"].includes(a)) throw new AppError("Choose an action.");
    await updateComplaint(await requireActor(), id, a as "REVIEW", str(fd, "note") ?? "");
    return "Complaint updated.";
  });
  revalidatePath(`/complaints/${id}`);
  return res;
}
