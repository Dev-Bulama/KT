import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/utils";
import { assessProjectRisk } from "@/modules/intelligence/risk";
import { blockerAction, resolveBlockerAction, riskAction, riskStatusAction, workLogAction } from "../actions";
import type { TabProps } from "./types";

export function RisksTab({ p, canWork }: TabProps) {
  const now = new Date();
  const openBlockers = p.blockers.filter((b) => !b.resolvedAt);
  const assessment = assessProjectRisk({
    status: p.status, plannedEndDate: p.plannedEndDate, startedAt: p.startedAt, progressPercent: p.progressPercent,
    overdueMilestones: p.milestones.filter((m) => m.dueDate && m.dueDate < now && ["PENDING", "IN_PROGRESS"].includes(m.status)).length,
    openBlockers: openBlockers.length, oldestBlockerDays: openBlockers.length ? Math.max(...openBlockers.map((b) => (now.getTime() - b.raisedAt.getTime()) / 86400000)) : null,
    scopeChanges: p.scopeChanges.length, pendingAckOverdue: p.assignments.filter((a) => a.status === "PENDING_ACKNOWLEDGMENT" && a.expectedAckBy < now).length,
    openHighRisks: p.risks.filter((r) => r.status === "OPEN" && r.likelihood * r.impact >= 12).length, remediationCount: p.remediationCount, historicalMedianDurationDays: null,
  });
  const hidden = <input type="hidden" name="projectId" value={p.id} />;
  return (
    <div className="space-y-6">
      <Card><CardHeader title="Delay risk indicators" description="Explainable rules — no predictive accuracy is claimed." actions={<StatusBadge status={assessment.level} />} /><CardBody>
        {assessment.flags.length ? <ul className="space-y-1 text-sm">{assessment.flags.map((f) => <li key={f.code}><StatusBadge status={f.severity} /> {f.message}</li>)}</ul> : <p className="text-sm text-muted">No risk indicators triggered.</p>}
      </CardBody></Card>
      <Card><CardHeader title="Risk register" />
        <Table caption="Risks"><THead><tr><TH>Risk</TH><TH>L×I</TH><TH>Mitigation</TH><TH>Status</TH><TH /></tr></THead>
          <tbody>{p.risks.map((r) => (
            <TR key={r.id}><TD><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{r.description}</p></TD><TD className="tabular-nums">{r.likelihood}×{r.impact} = {r.likelihood * r.impact}</TD><TD className="text-sm">{r.mitigation ?? "—"}</TD><TD><StatusBadge status={r.status} /></TD>
              <TD>{canWork && r.status === "OPEN" && <ActionForm inline action={riskStatusAction} submitLabel="Mark mitigated" submitVariant="secondary">{hidden}<input type="hidden" name="riskId" value={r.id} /><input type="hidden" name="status" value="MITIGATED" /></ActionForm>}</TD></TR>
          ))}{!p.risks.length && <TR><TD colSpan={5} className="text-muted">No risks recorded.</TD></TR>}</tbody>
        </Table>
      </Card>
      <Card><CardHeader title="Blockers" /><CardBody className="space-y-3">
        {p.blockers.length === 0 && <p className="text-sm text-muted">No blockers reported.</p>}
        {p.blockers.map((b) => (
          <div key={b.id} className="rounded-md border border-line p-3 text-sm">
            <p>{b.description}</p>
            <p className="text-xs text-muted">Raised by {b.raisedBy.name} · {formatDateTime(b.raisedAt)}{b.resolvedAt ? ` · resolved ${formatDateTime(b.resolvedAt)}: ${b.resolution}` : ""}</p>
            {!b.resolvedAt && canWork && <ActionForm inline action={resolveBlockerAction} submitLabel="Resolve" submitVariant="secondary" className="mt-2">{hidden}<input type="hidden" name="blockerId" value={b.id} /><Input name="resolution" placeholder="How was it resolved?" aria-label="Resolution" required className="h-8 w-72" /></ActionForm>}
          </div>
        ))}
      </CardBody></Card>
      <Card><CardHeader title="Work logs" description="Most recent 50 entries" />
        <Table caption="Work logs"><THead><tr><TH>Date</TH><TH>Officer</TH><TH>Hours</TH><TH>Description</TH></tr></THead>
          <tbody>{p.workLogs.map((w) => <TR key={w.id}><TD>{formatDate(w.workDate)}</TD><TD>{w.user.name}</TD><TD className="tabular-nums">{w.hours.toString()}</TD><TD>{w.description}</TD></TR>)}{!p.workLogs.length && <TR><TD colSpan={4} className="text-muted">No work logged.</TD></TR>}</tbody>
        </Table>
      </Card>
      {canWork && !["CLOSED", "CANCELLED"].includes(p.status) && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card><CardHeader title="Record a risk" /><CardBody>
            <ActionForm action={riskAction} submitLabel="Add risk" resetOnSuccess>{hidden}
              <Field label="Title" name="title" required><Input /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Likelihood (1–5)" name="likelihood" required><Select defaultValue="3">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></Field>
                <Field label="Impact (1–5)" name="impact" required><Select defaultValue="3">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></Field>
              </div>
              <Field label="Mitigation" name="mitigation"><Textarea rows={2} /></Field>
            </ActionForm>
          </CardBody></Card>
          <Card><CardHeader title="Report a blocker" /><CardBody>
            <ActionForm action={blockerAction} submitLabel="Report blocker" resetOnSuccess>{hidden}
              <Field label="Description" name="description" required><Textarea rows={3} /></Field>
              <Checkbox name="markBlocked" label="Mark the project as BLOCKED" />
            </ActionForm>
          </CardBody></Card>
          <Card><CardHeader title="Log work" /><CardBody>
            <ActionForm action={workLogAction} submitLabel="Save work log" resetOnSuccess>{hidden}
              <div className="grid grid-cols-2 gap-3"><Field label="Date" name="workDate" required><Input type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field><Field label="Hours" name="hours" required><Input type="number" step="0.25" min="0.25" max="24" /></Field></div>
              <Field label="Task" name="taskId"><Select defaultValue=""><option value="">— General —</option>{p.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select></Field>
              <Field label="Work performed" name="description" required><Textarea rows={2} /></Field>
            </ActionForm>
          </CardBody></Card>
        </div>
      )}
    </div>
  );
}
