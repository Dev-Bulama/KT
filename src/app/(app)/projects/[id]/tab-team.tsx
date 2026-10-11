import { prisma } from "@/lib/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, humanize } from "@/lib/utils";
import { canAssignOnProject } from "@/modules/projects/access";
import { recommendAssignees } from "@/modules/ai/features";
import { acknowledgeAction, assignAction, reassignAction } from "../actions";
import type { TabProps } from "./types";

export async function TeamTab({ p, actor }: TabProps) {
  const mode = canAssignOnProject(actor, p);
  const active = p.assignments.filter((a) => ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"].includes(a.status));
  const mine = active.filter((a) => a.assignee.id === actor.id && a.status === "PENDING_ACKNOWLEDGMENT");
  const [officers, departments, recs] = mode ? await Promise.all([
    prisma.user.findMany({ where: { userType: "KATDICT_STAFF", status: "ACTIVE", roles: { some: { role: { permissions: { some: { permission: { key: "project.update" } } } } } }, ...(mode === "department" ? { departmentId: p.departmentId } : {}) }, select: { id: true, name: true, department: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    recommendAssignees(actor, p.id),
  ]) : [[], [], []];
  const canInitial = mode && ["APPROVED", "PLANNING"].includes(p.status);
  const hidden = <input type="hidden" name="projectId" value={p.id} />;
  return (
    <div className="space-y-6">
      {mine.map((a) => (
        <Card key={a.id} className="border-amber-300"><CardHeader title="Your assignment needs acknowledgement" description={`${humanize(a.role)} · assigned by ${a.assignedBy.name} · respond by ${formatDateTime(a.expectedAckBy)}`} /><CardBody className="space-y-2 text-sm">
          <p><strong>Instructions:</strong> {a.instructions}</p><p><strong>Expected outcomes:</strong> {a.expectedOutcomes}</p>
          <ActionForm action={acknowledgeAction} submitLabel="Acknowledge assignment" submitVariant="accent">{hidden}<input type="hidden" name="assignmentId" value={a.id} /></ActionForm>
        </CardBody></Card>
      ))}
      <Card><CardHeader title="Assignment history" description="Every assignment, acknowledgement and reassignment is preserved." />
        <Table caption="Assignments">
          <THead><tr><TH>Person</TH><TH>Role</TH><TH>Status</TH><TH>Assigned</TH><TH>Acknowledge by</TH><TH>Acknowledged</TH><TH>Ended / reason</TH></tr></THead>
          <tbody>{p.assignments.map((a) => (
            <TR key={a.id}><TD>{a.assignee.name}</TD><TD>{humanize(a.role)}</TD><TD><StatusBadge status={a.status} />{a.escalatedAt && <span className="ml-1 text-xs text-danger-700">escalated</span>}</TD><TD className="text-xs">{formatDateTime(a.assignedAt)}<br /><span className="text-muted">by {a.assignedBy.name}</span></TD><TD className="text-xs">{formatDateTime(a.expectedAckBy)}</TD><TD className="text-xs">{formatDateTime(a.acknowledgedAt)}</TD><TD className="text-xs">{a.endedAt ? `${formatDateTime(a.endedAt)} — ${a.endReason}` : "—"}</TD></TR>
          ))}{!p.assignments.length && <TR><TD colSpan={7} className="text-muted">No assignments yet.</TD></TR>}</tbody>
        </Table>
      </Card>
      {mode && recs.length > 0 && (
        <Card><CardHeader title="Assignment recommendations" description="Transparent scoring from recorded skills, workload, department and delivery history. A recommendation only — you decide." /><CardBody>
          <ul className="space-y-3 text-sm">{recs.map((r) => (
            <li key={r.userId} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap justify-between gap-2"><strong>{r.name}</strong><span className="tabular-nums">{r.score}/100{r.atCapacity && <span className="ml-2 text-xs text-warn-700">at capacity</span>}</span></div>
              <ul className="mt-1 grid gap-x-4 text-xs text-muted sm:grid-cols-2">{r.criteria.map((c) => <li key={c.label}>{c.label}: {c.value} (+{c.points})</li>)}</ul>
            </li>
          ))}</ul>
        </CardBody></Card>
      )}
      {canInitial && (
        <Card><CardHeader title="Assign project team" description="Assignees receive email and in-app notifications and must acknowledge." /><CardBody>
          <ActionForm action={assignAction} submitLabel="Create assignments">
            <>
              {hidden}<input type="hidden" name="version" value={p.version} />
              <div className="grid gap-4 md:grid-cols-2">
                {mode === "global" && <Field label="Responsible department" name="departmentId"><Select defaultValue={p.departmentId ?? ""}><option value="">— Select —</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>}
                <Field label="Project manager" name="projectManagerId" required><Select defaultValue=""><option value="">— Select —</option>{officers.map((o) => <option key={o.id} value={o.id}>{o.name}{o.department ? ` (${o.department.name})` : ""}</option>)}</Select></Field>
                <Field label="ICT officers" name="officerIds" hint="Hold Ctrl/Cmd to select several."><Select multiple className="h-28">{officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
                <Field label="Start date" name="startDate"><Input type="date" /></Field>
                <Field label="Delivery target (planned completion)" name="plannedEndDate"><Input type="date" defaultValue={p.plannedEndDate?.toISOString().slice(0, 10)} /></Field>
                <Field label="Estimated effort (days)" name="estimatedEffortDays"><Input type="number" min={1} defaultValue={p.estimatedEffortDays ?? ""} /></Field>
                <Field label="Risk level" name="riskLevel"><Select defaultValue={p.riskLevel}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select></Field>
                <Field label="Reporting frequency" name="reportingFrequency"><Select defaultValue={p.reportingFrequency}>{["WEEKLY", "FORTNIGHTLY", "MONTHLY"].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select></Field>
                <Field label="Instructions" name="instructions" required className="md:col-span-2"><Textarea rows={3} /></Field>
                <Field label="Expected outcomes" name="expectedOutcomes" required className="md:col-span-2"><Textarea rows={2} /></Field>
                <Field label="Required resources" name="requiredResources"><Textarea rows={2} /></Field>
                <Field label="Dependencies" name="dependenciesNote"><Textarea rows={2} /></Field>
              </div>
              <Checkbox name="allowOverCapacity" label="Allow assignment above recorded capacity (justify in instructions)" />
            </>
          </ActionForm>
        </CardBody></Card>
      )}
      {mode && active.length > 0 && !["CLOSED", "CANCELLED"].includes(p.status) && (
        <Card><CardHeader title="Reassign" description="A reason is required and the previous assignment is preserved." /><CardBody>
          <ActionForm action={reassignAction} submitLabel="Reassign" resetOnSuccess>
            {hidden}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Current assignment" name="assignmentId" required><Select defaultValue="">{[<option key="" value="">— Select —</option>, ...active.map((a) => <option key={a.id} value={a.id}>{a.assignee.name} ({humanize(a.role)})</option>)]}</Select></Field>
              <Field label="New assignee" name="newAssigneeId" required><Select defaultValue="">{[<option key="" value="">— Select —</option>, ...officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)]}</Select></Field>
              <Field label="Reason" name="reason" required className="md:col-span-2"><Textarea rows={2} /></Field>
            </div>
            <Checkbox name="allowOverCapacity" label="Allow above capacity" />
          </ActionForm>
        </CardBody></Card>
      )}
    </div>
  );
}
