import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Select, Textarea, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { Alert, DescriptionList } from "@/components/ui/misc";
import { AttachmentList } from "@/components/shared/attachment-list";
import { formatDateTime, humanize } from "@/lib/utils";
import { can } from "@/modules/rbac/authorize";
import { acceptanceAction, closeAction, completionAction, feedbackAction, reviewCompletionAction } from "../actions";
import type { TabProps } from "./types";

export function CompletionTab({ p, actor, isAssigned, internal }: TabProps) {
  const hidden = <input type="hidden" name="projectId" value={p.id} />;
  const isDeptHead = !!p.departmentId && actor.headOfDepartmentIds.includes(p.departmentId);
  const canSubmit = p.status === "IN_PROGRESS" && isAssigned && can(actor, "project.completion.submit");
  const canReview = p.status === "UNDER_REVIEW" && can(actor, "project.completion.review") && !isAssigned && (can(actor, "project.read.all") || isDeptHead);
  const canAccept = p.status === "AWAITING_MDA_ACCEPTANCE" && actor.userType === "MDA_USER" && actor.mdaId === p.mda.id && can(actor, "project.accept");
  const canClose = p.status === "ACCEPTED" && can(actor, "project.close") && !isAssigned;
  const canExceptional = can(actor, "project.close.exceptional") && ["IN_PROGRESS", "ON_HOLD", "BLOCKED", "UNDER_REVIEW", "AWAITING_MDA_ACCEPTANCE", "ACCEPTED"].includes(p.status);
  const myFeedback = p.feedback.find((f) => f.userId === actor.id);
  return (
    <div className="space-y-6">
      <ol className="grid gap-2 text-sm sm:grid-cols-5">
        {["Officer submits", "KATDICT review", "MDA acceptance", "Remediation (if disputed)", "Final closure"].map((s, i) => {
          const stage = p.status === "CLOSED" ? 5 : p.status === "ACCEPTED" ? 4 : p.status === "AWAITING_MDA_ACCEPTANCE" ? 2 : p.status === "UNDER_REVIEW" ? 1 : 0;
          return <li key={s} className={`rounded-md border px-3 py-2 ${i < stage ? "border-green-200 bg-accent-100 text-accent-700" : i === stage ? "border-navy-700 bg-navy-50 font-medium" : "border-line text-muted"}`}>{i + 1}. {s}</li>;
        })}
      </ol>
      <p className="text-sm">Acceptance status: <StatusBadge status={p.acceptanceStatus} />{p.remediationCount > 0 && <span className="ml-2 text-xs text-warn-700">{p.remediationCount} remediation cycle(s)</span>}</p>

      {p.completionSubmissions.map((s) => (
        <Card key={s.id}><CardHeader title={`Completion submission — cycle ${s.cycle}`} description={`${s.submittedBy.name} · ${formatDateTime(s.createdAt)}`} actions={<StatusBadge status={s.status} />} /><CardBody className="space-y-3">
          <DescriptionList items={[
            ["Summary of work", s.summary], ["Deliverables", s.deliverablesSummary], ["Evidence", s.evidenceSummary], ["Technical documentation", s.technicalDocumentation],
            ["Outstanding issues", s.outstandingIssues], ["Deployment / handover", s.handoverInformation], ["Training records", s.trainingRecords],
            ["Maintenance instructions", s.maintenanceInstructions], ["Recommended next steps", s.recommendedNextSteps],
          ]} />
          {s.attachments.length > 0 && <AttachmentList items={s.attachments} showVisibility={internal} />}
          {s.reviewedAt && <Alert tone={s.status === "APPROVED" ? "success" : "warning"}>KATDICT review by {s.reviewedBy?.name} on {formatDateTime(s.reviewedAt)}: {humanize(s.status)}{s.reviewNotes ? ` — ${s.reviewNotes}` : ""}</Alert>}
        </CardBody></Card>
      ))}
      {p.acceptanceDecisions.length > 0 && (
        <Card><CardHeader title="MDA decisions" /><CardBody><ul className="space-y-2 text-sm">{p.acceptanceDecisions.map((a) => <li key={a.id}><StatusBadge status={a.outcome === "ACCEPTED" ? "ACCEPTED" : a.outcome === "CLARIFICATION_REQUESTED" ? "NEEDS_INFORMATION" : "DISPUTED"} /> {humanize(a.outcome)} by {a.decidedBy.name} · {formatDateTime(a.createdAt)}{a.reason ? ` — ${a.reason}` : ""}</li>)}</ul></CardBody></Card>
      )}

      {canSubmit && (
        <Card><CardHeader title="Submit for completion review" description="All milestones must be complete or cancelled, and required deliverables submitted. Upload evidence under Deliverables & files first." /><CardBody>
          <ActionForm action={completionAction} submitLabel="Submit for review" submitVariant="accent">
            <>{hidden}
              <Field label="Summary of work performed" name="summary" required><Textarea rows={3} /></Field>
              <Field label="Deliverables" name="deliverablesSummary" required><Textarea rows={2} /></Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Evidence" name="evidenceSummary"><Textarea rows={2} /></Field>
                <Field label="Technical documentation" name="technicalDocumentation"><Textarea rows={2} /></Field>
                <Field label="Outstanding issues" name="outstandingIssues"><Textarea rows={2} /></Field>
                <Field label="Deployment / handover information" name="handoverInformation"><Textarea rows={2} /></Field>
                <Field label="Training records" name="trainingRecords"><Textarea rows={2} /></Field>
                <Field label="Maintenance instructions" name="maintenanceInstructions"><Textarea rows={2} /></Field>
              </div>
              <Field label="Recommended next steps" name="recommendedNextSteps"><Textarea rows={2} /></Field>
            </>
          </ActionForm>
        </CardBody></Card>
      )}
      {canReview && (
        <Card><CardHeader title="KATDICT completion review" description="Members of the delivery team cannot review their own work." /><CardBody>
          <ActionForm action={reviewCompletionAction} submitLabel="Record review">{hidden}
            <Field label="Outcome" name="outcome" required><Select defaultValue=""><option value="">— Choose —</option><option value="APPROVED">Approve — send to MDA for acceptance</option><option value="EVIDENCE_REQUESTED">Request additional evidence</option><option value="RETURNED">Return for correction</option><option value="REJECTED">Reject submission</option></Select></Field>
            <Field label="Notes" name="notes" hint="Required unless approving."><Textarea rows={3} /></Field>
          </ActionForm>
        </CardBody></Card>
      )}
      {canAccept && (
        <Card className="border-amber-300"><CardHeader title="Your acceptance decision" description="Review the submission and deliverables above. If you dispute, the project returns to KATDICT for remediation." /><CardBody>
          <ActionForm action={acceptanceAction} submitLabel="Submit decision">{hidden}
            <Field label="Decision" name="outcome" required><Select defaultValue=""><option value="">— Choose —</option><option value="ACCEPTED">Accept the deliverables</option><option value="INCOMPLETE_DELIVERABLES">Report incomplete deliverables</option><option value="REJECTED">Reject acceptance</option><option value="CLARIFICATION_REQUESTED">Request clarification</option></Select></Field>
            <Field label="Reasons / comments" name="reason" hint="Required unless accepting."><Textarea rows={3} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rating (optional, 1–5)" name="rating"><Select defaultValue=""><option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
              <Field label="Feedback (optional)" name="feedback"><Textarea rows={2} /></Field>
            </div>
          </ActionForm>
        </CardBody></Card>
      )}
      {(canClose || canExceptional) && (
        <Card><CardHeader title={canClose ? "Close project" : "Exceptional closure"} description={canClose ? "Generates the official completion report. The delivery team cannot close its own project." : "Only for formally authorised cases. Requires a detailed justification and is fully audited."} /><CardBody>
          <ActionForm action={closeAction} submitLabel={canClose ? "Close project" : "Close under exceptional policy"} submitVariant={canClose ? "primary" : "danger"} confirm="Close this project? This is final.">
            <>{hidden}
              {!canClose && <input type="hidden" name="exceptional" value="true" />}
              <Field label="Actual outcome" name="actualOutcome" required><Textarea rows={3} /></Field>
              <Field label="Lessons learned" name="lessonsLearned" hint="Becomes a draft knowledge-repository entry for approval."><Textarea rows={3} /></Field>
              <Field label="Follow-up recommendations" name="followUpRecommendations"><Textarea rows={2} /></Field>
              {canClose && canExceptional && <Checkbox name="exceptional" label="Use exceptional closure instead" />}
              {(!canClose || canExceptional) && <Field label="Exceptional closure justification" name="justification"><Textarea rows={2} /></Field>}
            </>
          </ActionForm>
        </CardBody></Card>
      )}
      {actor.userType === "MDA_USER" && can(actor, "feedback.submit") && ["ACCEPTED", "CLOSED"].includes(p.status) && (
        <Card><CardHeader title={myFeedback ? "Update your feedback" : "Rate this project"} /><CardBody>
          <ActionForm action={feedbackAction} submitLabel="Save feedback">{hidden}
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <Field label="Rating" name="rating" required><Select defaultValue={String(myFeedback?.rating ?? "")}><option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
              <Field label="Comments" name="comments"><Textarea rows={2} defaultValue={myFeedback?.comments ?? ""} /></Field>
            </div>
          </ActionForm>
        </CardBody></Card>
      )}
    </div>
  );
}
