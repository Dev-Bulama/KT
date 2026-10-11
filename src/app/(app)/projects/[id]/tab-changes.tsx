import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Field, Input, Textarea, Select } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDateTime } from "@/lib/utils";
import { can } from "@/modules/rbac/authorize";
import { scopeChangeAction, scopeDecisionAction } from "../actions";
import type { TabProps } from "./types";

export function ChangesTab({ p, actor, canWork }: TabProps) {
  const canRequest = can(actor, "project.scope.request") && !["CLOSED", "CANCELLED", "ACCEPTED"].includes(p.status) && (actor.userType === "MDA_USER" ? actor.mdaId === p.mda.id : canWork);
  const canDecide = can(actor, "project.scope.decide");
  const hidden = <input type="hidden" name="projectId" value={p.id} />;
  return (
    <div className="space-y-6">
      {p.scopeChanges.length === 0 && <p className="text-sm text-muted">No scope changes have been requested. Approved scope is never silently overwritten.</p>}
      {p.scopeChanges.map((c) => (
        <Card key={c.id}><CardHeader title={<span className="flex items-center gap-2">Change requested by {c.requestedBy.name} <Badge>{c.requestingParty}</Badge> <StatusBadge status={c.status} /></span>} description={formatDateTime(c.createdAt)} /><CardBody className="space-y-2 text-sm">
          <p><strong>Proposed change:</strong> {c.proposedChange}</p>
          <p><strong>Reason:</strong> {c.reason}</p>
          {c.impactAssessment && <p><strong>Impact:</strong> {c.impactAssessment}</p>}
          <p><strong>Schedule impact:</strong> {c.scheduleImpactDays ?? 0} days · <strong>Resources:</strong> {c.resourceImpact ?? "—"}</p>
          <details><summary className="cursor-pointer text-muted">Scope at the time of request</summary><p className="mt-1 whitespace-pre-line">{c.originalScope}</p></details>
          {c.decidedAt && <p className="text-muted">Decision by {c.decidedBy?.name} on {formatDateTime(c.decidedAt)}: {c.decisionReason}</p>}
          {c.status === "PENDING" && canDecide && (
            <ActionForm action={scopeDecisionAction} submitLabel="Record decision">{hidden}<input type="hidden" name="scopeChangeId" value={c.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Decision" name="decision" required><Select defaultValue=""><option value="">—</option><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></Select></Field>
                <Field label="Reason" name="reason" required><Input /></Field>
              </div>
            </ActionForm>
          )}
        </CardBody></Card>
      ))}
      {canRequest && (
        <Card><CardHeader title="Request a scope change" /><CardBody>
          <ActionForm action={scopeChangeAction} submitLabel="Submit change request" resetOnSuccess>
            <>{hidden}
              <Field label="Proposed change" name="proposedChange" required><Textarea rows={3} /></Field>
              <Field label="Reason" name="reason" required><Textarea rows={2} /></Field>
              <Field label="Impact assessment" name="impactAssessment"><Textarea rows={2} /></Field>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="Schedule impact (days)" name="scheduleImpactDays"><Input type="number" /></Field><Field label="Resource implications" name="resourceImpact"><Input /></Field></div>
            </>
          </ActionForm>
        </CardBody></Card>
      )}
    </div>
  );
}
