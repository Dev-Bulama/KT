"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { requireActor } from "@/modules/auth/current";
import { finalizeReport, generatePeriodicReport, type ReportTemplate } from "@/modules/reports/periodic";
import { draftReportSummary } from "@/modules/ai/features";

export async function generateReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null;
  const res = await runAction(async () => {
    const rep = await generatePeriodicReport(await requireActor(), str(fd, "template") as ReportTemplate, {
      month: str(fd, "month") || undefined, quarter: str(fd, "quarter") || undefined, year: str(fd, "year") || undefined,
      mdaId: str(fd, "mdaId") || undefined, departmentId: str(fd, "departmentId") || undefined, from: str(fd, "from") || undefined, to: str(fd, "to") || undefined,
    });
    id = rep.id;
  });
  if (res.ok && id) redirect(`/reports/${id}`);
  return res;
}

export async function draftSummaryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    const r = await draftReportSummary(await requireActor(), id);
    return r.notice ?? "Draft summary generated. Review and edit before finalising.";
  });
  revalidatePath(`/reports/${id}`);
  return res;
}

export async function finalizeReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id")!;
  const res = await runAction(async () => {
    await finalizeReport(await requireActor(), id, str(fd, "summary") ?? "");
    return "Report finalised.";
  });
  revalidatePath(`/reports/${id}`);
  return res;
}
