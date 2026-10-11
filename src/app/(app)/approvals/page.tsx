import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { assertCanAny } from "@/modules/rbac/authorize";
import { listApprovalQueue } from "@/modules/requests/service";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { formatNaira } from "@/lib/utils";

export const metadata = { title: "Approvals" };

export default async function Approvals() {
  const actor = await requirePageActor();
  assertCanAny(actor, ["request.approve.technical", "request.approve.department", "request.approve.executive"]);
  const queue = await listApprovalQueue(actor);
  const mine = queue.filter((q) => q.canDecide);
  const others = queue.filter((q) => !q.canDecide);
  const row = (q: (typeof queue)[number]) => (
    <TR key={q.request.id}>
      <TD className="font-medium"><Link href={`/requests/${q.request.id}`}>{q.request.reference}</Link></TD>
      <TD>{q.request.title}</TD>
      <TD>{q.request.mda.abbreviation}</TD>
      <TD><StatusBadge status={q.request.priority} /></TD>
      <TD className="tabular-nums">{q.request.estimatedEffortDays ?? "—"} d · {formatNaira(q.request.estimatedCostNgn?.toString())}</TD>
      <TD>{q.state.state === "pending" ? <Badge tone="warning">{q.state.nextStep.name}</Badge> : <StatusBadge status={q.state.state.toUpperCase()} />}</TD>
    </TR>
  );
  return (
    <>
      <PageHeader title="Approval workspace" description="Requests in approval review. Steps and thresholds follow the configured approval policy; you can decide only steps matching your authority, and only once per cycle." />
      <h2 className="mb-2 text-base font-semibold">Awaiting your decision ({mine.length})</h2>
      {mine.length ? (
        <Table caption="Awaiting your decision"><THead><tr><TH>Reference</TH><TH>Title</TH><TH>MDA</TH><TH>Priority</TH><TH>Effort · cost</TH><TH>Pending step</TH></tr></THead><tbody>{mine.map(row)}</tbody></Table>
      ) : <EmptyState title="Nothing awaits your decision" />}
      <h2 className="mb-2 mt-8 text-base font-semibold">Other requests in approval ({others.length})</h2>
      {others.length ? (
        <Table caption="Other requests in approval"><THead><tr><TH>Reference</TH><TH>Title</TH><TH>MDA</TH><TH>Priority</TH><TH>Effort · cost</TH><TH>Pending step</TH></tr></THead><tbody>{others.map(row)}</tbody></Table>
      ) : <p className="text-sm text-muted">None.</p>}
    </>
  );
}
