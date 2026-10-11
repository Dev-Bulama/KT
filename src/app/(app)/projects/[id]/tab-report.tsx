import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/forms/action-form";
import { DescriptionList } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/utils";
import { can } from "@/modules/rbac/authorize";
import type { ProjectReportData } from "@/modules/reports/project-report";
import { regenerateReportAction } from "../actions";
import type { TabProps } from "./types";

const d = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "Not recorded");
const n = (v: number | null, u = "") => (v === null || v === undefined ? "Not recorded" : `${v}${u}`);

export async function ReportTab({ p, actor }: TabProps) {
  const latest = p.reports.find((r) => r.type === "PROJECT_CLOSURE");
  if (!latest) return <p className="text-sm text-muted">No completion report yet. It is generated automatically when the project is closed.</p>;
  const rep = await prisma.reportRecord.findUniqueOrThrow({ where: { id: latest.id } });
  const r = rep.data as unknown as ProjectReportData;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={rep.status} /><span className="text-sm text-muted">Version {rep.version} · generated {formatDateTime(rep.generatedAt)}</span>
        <Button size="sm" variant="secondary" asChild><a href={`/api/reports/${rep.id}/pdf`}>Download PDF</a></Button>
        <Button size="sm" variant="secondary" asChild><a href={`/api/reports/${rep.id}/csv`}>Download CSV</a></Button>
        <Button size="sm" variant="ghost" asChild><Link href={`/reports/${rep.id}`}>Review &amp; finalise</Link></Button>
        {can(actor, "report.generate") && actor.userType !== "MDA_USER" && <ActionForm inline action={regenerateReportAction} submitLabel="Generate new version" submitVariant="ghost"><input type="hidden" name="projectId" value={p.id} /></ActionForm>}
      </div>
      <Card><CardHeader title="Timeline" /><CardBody><DescriptionList items={Object.entries(r.timeline).map(([k, v]) => [k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), d(v)])} /></CardBody></Card>
      <Card><CardHeader title="Performance" description="Derived from status history; values not captured are marked 'Not recorded'." /><CardBody><DescriptionList items={[
        ["Calendar days (submission → closure)", n(r.performance.calendarDaysSubmissionToClosure)], ["Working days (submission → closure)", n(r.performance.workingDaysSubmissionToClosure)],
        ["Execution duration", n(r.performance.executionDurationDays, " days")], ["Planned vs actual", r.performance.plannedVsActual ?? "Not recorded"], ["Delay", n(r.performance.delayDays, " days")],
        ["Awaiting MDA information", n(r.performance.daysAwaitingMdaInformation, " working days")], ["Awaiting approval", n(r.performance.daysAwaitingApproval, " working days")], ["Blocked", n(r.performance.daysBlocked, " working days")],
        ["Milestones", `${r.performance.milestonesCompleted} of ${r.performance.milestonesTotal} completed`], ["Change requests", String(r.performance.changeRequests)], ["Risks recorded", String(r.performance.risksRecorded)], ["Review cycles", String(r.performance.reviewCycles)],
      ]} /></CardBody></Card>
      <Card><CardHeader title="Accountability" /><CardBody><DescriptionList items={[
        ["Approved by", r.accountability.approvedBy.map((x) => x.name).join(", ") || "Not recorded"], ["Assigned by", r.accountability.assignedBy?.name ?? "Not recorded"],
        ["Performed by", r.accountability.performedBy.map((x) => x.name).join(", ") || "Not recorded"], ["Completion reviewed by", r.accountability.completionReviewedBy?.name ?? "Not recorded"],
        ["Accepted by", r.accountability.acceptedBy?.name ?? "Not recorded"], ["Closed by", r.accountability.closedBy?.name ?? "Not recorded"],
      ]} /></CardBody></Card>
    </div>
  );
}
