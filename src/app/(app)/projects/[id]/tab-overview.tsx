import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime, humanize } from "@/lib/utils";
import type { TabProps } from "./types";

/** Digital Project Passport: the authoritative summary of the project record. */
export function OverviewTab({ p, internal }: TabProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card><CardHeader title="Original request" /><CardBody>
          <DescriptionList items={[["Service", `${p.request.service.category.name} › ${p.request.service.name}`], ["Problem", p.request.problemStatement], ["Desired outcome", p.request.desiredOutcome]]} />
        </CardBody></Card>
        <Card><CardHeader title="Approved scope" description="Changes are recorded under Change control; history is never overwritten." /><CardBody><p className="whitespace-pre-line text-sm">{p.approvedScope}</p></CardBody></Card>
        <Card><CardHeader title="Status history" /><CardBody>
          <ol className="space-y-2 text-sm">
            {p.history.map((h) => (
              <li key={String(h.id)} className="flex flex-wrap items-center gap-2">
                <span className="w-40 text-xs text-muted">{formatDateTime(h.createdAt)}</span>
                {h.fromStatus && <><StatusBadge status={h.fromStatus} /><span aria-hidden>→</span></>}<StatusBadge status={h.toStatus} />
                <span className="text-xs text-muted">{humanize(h.action)} · {internal ? (h.actor?.name ?? "System") : h.actor?.userType === "MDA_USER" ? h.actor.name : "KATDICT"}</span>
                {h.reason && <span className="w-full pl-40 text-xs italic text-muted">“{h.reason}”</span>}
              </li>
            ))}
          </ol>
        </CardBody></Card>
      </div>
      <div className="space-y-6">
        <Card><CardHeader title="Key facts" /><CardBody>
          <DescriptionList className="sm:grid-cols-1" items={[
            ["Department", p.department?.name ?? "Not assigned"], ["Priority", humanize(p.priority)], ["Reporting frequency", humanize(p.reportingFrequency)],
            ["Estimated effort", p.estimatedEffortDays ? `${p.estimatedEffortDays} days` : "Not recorded"], ["Start date", formatDate(p.startDate)],
            ["Assigned", formatDateTime(p.assignedAt)], ["Acknowledged", formatDateTime(p.acknowledgedAt)], ["Work started", formatDateTime(p.startedAt)],
            ["Completion submitted", formatDateTime(p.completionSubmittedAt)], ["MDA accepted", formatDateTime(p.acceptedAt)], ["Closed", formatDateTime(p.closedAt)],
            ...(internal ? [["Required resources", p.requiredResources ?? "—"], ["Dependencies", p.dependenciesNote ?? "—"]] as [string, string][] : []),
          ]} />
        </CardBody></Card>
        {p.closure && <Card><CardHeader title="Closure" /><CardBody><DescriptionList className="sm:grid-cols-1" items={[["Type", humanize(p.closure.closureType)], ["Closed by", p.closure.closedBy.name], ["Outcome", p.closure.actualOutcome], ...(p.closure.justification ? [["Justification", p.closure.justification]] as [string, string][] : [])]} /></CardBody></Card>}
      </div>
    </div>
  );
}
