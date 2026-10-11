import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/modules/auth/current";
import { can, canAny } from "@/modules/rbac/authorize";
import { getApprovalState, getRequest } from "@/modules/requests/service";
import { availableRequestActions, PAUSED_REQUEST_STATUSES, REQUEST_TRANSITIONS } from "@/modules/requests/workflow";
import { evaluateSla, timeBreakdown } from "@/modules/sla/sla";
import { loadCalendar } from "@/modules/sla/service";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { PageHeader, Alert, DescriptionList } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { FileUploader } from "@/components/forms/file-uploader";
import { AttachmentList } from "@/components/shared/attachment-list";
import { DecisionTrail } from "@/components/shared/decision-trail";
import { AiPanel } from "@/components/shared/ai-panel";
import { formatDate, formatDateTime, formatNaira, humanize } from "@/lib/utils";
import { aiClassifyAction, aiQualityAction, approvalAction, assessmentAction, commentAction, deleteDraftAction, initiateProjectAction, transitionAction } from "../actions";

export const metadata = { title: "Request" };

export default async function RequestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requirePageActor();
  let r: Awaited<ReturnType<typeof getRequest>>;
  try {
    r = await getRequest(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const katdict = actor.userType === "KATDICT_STAFF";
  const isMda = actor.userType === "MDA_USER";
  const tab = sp.tab ?? "details";
  const actions = availableRequestActions(r.status, actor.permissions).filter((a) => !["submit", "approval_decision", "initiate_project"].includes(a) && (REQUEST_TRANSITIONS[a].side === "MDA" ? isMda : katdict));
  const [approval, departments, officers, cal] = await Promise.all([
    r.status === "APPROVAL_REVIEW" || r.approvalDecisions.length ? getApprovalState(r.id) : null,
    katdict ? prisma.department.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    katdict ? prisma.user.findMany({ where: { userType: "KATDICT_STAFF", status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    loadCalendar(),
  ]);
  const terminal = ["APPROVED", "REJECTED", "WITHDRAWN", "PROJECT_INITIATED"].includes(r.status);
  const sla = r.submittedAt ? (() => {
    const t = timeBreakdown(r.history, r.submittedAt!, r.decidedAt ?? new Date(), PAUSED_REQUEST_STATUSES, cal);
    return { ...evaluateSla(t.activeWorkingDays, r.service.slaAssessmentDays ?? r.service.category.slaAssessmentDays, terminal), paused: t.pausedWorkingDays };
  })() : null;
  const stageForStatus: Record<string, string> = { SUBMITTED: "TRIAGE", INITIAL_TRIAGE: "TRIAGE", UNDER_ASSESSMENT: "ASSESSMENT", TECHNICAL_EVALUATION: "TECHNICAL", SCOPE_ESTIMATION: "SCOPE", RETURNED_FOR_REVISION: "SCOPE" };
  const stage = stageForStatus[r.status];
  const stagePerm = { TRIAGE: "request.triage", ASSESSMENT: "request.assess", TECHNICAL: "request.evaluate.technical", SCOPE: "request.scope" } as const;
  const canAssess = katdict && stage && can(actor, stagePerm[stage as keyof typeof stagePerm]);
  const myApproval = approval?.state.state === "pending" && actor.permissions.has(approval.state.nextStep.requiredPermission) && !approval.decisions.some((d) => d.decidedById === actor.id) && katdict;

  const tabs = [
    { key: "details", label: "Details" },
    { key: "messages", label: "Messages", count: r.comments.length },
    { key: "documents", label: "Documents", count: r.attachments.length },
    ...(katdict || actor.userType === "OVERSIGHT" ? [{ key: "assessments", label: "Assessments", count: r.assessments.length }] : []),
    { key: "trail", label: "Decision trail" },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Requests", href: "/requests" }, { label: r.reference ?? "Draft" }]}
        title={<span className="flex flex-wrap items-center gap-3">{r.title} <StatusBadge status={r.status} /></span>}
        description={<>{r.reference ?? "Draft (not yet submitted)"} · {r.mda.name} · {r.service.category.name} › {r.service.name}</>}
        actions={<>
          {r.status === "DRAFT" && r.createdBy.id === actor.id && <Button asChild><Link href={`/requests/${r.id}/edit`}>Continue draft</Link></Button>}
          {r.project && <Button variant="secondary" asChild><Link href={`/projects/${r.project.id}`}>Open project {r.project.reference}</Link></Button>}
        </>}
      />
      {sp.submitted && <Alert tone="success" className="mb-4" title="Request submitted">Reference {r.reference}. You will be notified as KATDICT reviews it.</Alert>}
      {r.status === "NEEDS_INFORMATION" && isMda && <Alert tone="warning" className="mb-4" title="KATDICT needs more information">Read the clarification request under Messages and submit your response below.</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Tabs basePath={`/requests/${r.id}`} active={tab} tabs={tabs} />
          {tab === "details" && (
            <div className="space-y-6">
              <Card><CardHeader title="Request information" /><CardBody>
                <DescriptionList items={[
                  ["Problem statement", r.problemStatement], ["Current situation", r.currentSituation], ["Desired outcome", r.desiredOutcome],
                  ["Business justification", r.businessJustification], ["Expected beneficiaries", r.expectedBeneficiaries], ["Estimated users", r.estimatedUsers?.toLocaleString()],
                  ["Urgency (MDA)", humanize(r.urgency)], ["Preferred completion", formatDate(r.preferredCompletionDate)], ["Existing systems", r.existingSystems],
                  ["Technical information", r.technicalInformation], ["Known dependencies", r.knownDependencies], ["Expected deliverables", r.expectedDeliverables], ["Success criteria", r.successCriteria],
                ]} />
              </CardBody></Card>
              <Card><CardHeader title="Impact and priority" /><CardBody>
                <DescriptionList items={[["Institutional impact", r.institutionalImpact], ["Operational urgency", r.operationalUrgency], ["Legal / regulatory considerations", r.legalConsiderations], ["Consequences of inaction", r.consequencesOfInaction]]} />
              </CardBody></Card>
              {(r.proposedScope || katdict) && (
                <Card><CardHeader title="KATDICT scope and estimation" /><CardBody>
                  <DescriptionList items={[["Proposed scope", r.proposedScope], ["Estimated effort", r.estimatedEffortDays ? `${r.estimatedEffortDays} days` : null], ...(katdict ? [["Estimated cost", formatNaira(r.estimatedCostNgn?.toString())] as [string, string]] : [])]} />
                </CardBody></Card>
              )}
            </div>
          )}
          {tab === "messages" && (
            <Card><CardBody className="space-y-4">
              {r.comments.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
              <ul className="space-y-3">
                {r.comments.map((c) => (
                  <li key={c.id} className={`rounded-md border p-3 text-sm ${c.visibility === "INTERNAL" ? "border-amber-200 bg-warn-100/40" : "border-line"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <strong className="text-ink">{isMda && c.author.userType !== "MDA_USER" ? "KATDICT" : c.author.name}</strong>
                      {c.kind !== "COMMENT" && <Badge tone="warning">{humanize(c.kind)}</Badge>}
                      {c.visibility === "INTERNAL" && <Badge tone="warning">Internal note</Badge>}
                      <span>{formatDateTime(c.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line">{c.body}</p>
                  </li>
                ))}
              </ul>
              {r.status !== "DRAFT" && actor.userType !== "OVERSIGHT" && (
                <ActionForm action={commentAction} submitLabel="Post message" resetOnSuccess>
                  <input type="hidden" name="id" value={r.id} />
                  <Field label="Message" name="body" required><Textarea rows={3} /></Field>
                  {katdict && <Field label="Visibility" name="visibility"><Select defaultValue="MDA_VISIBLE"><option value="MDA_VISIBLE">Visible to the MDA</option><option value="INTERNAL">Internal KATDICT note</option></Select></Field>}
                </ActionForm>
              )}
            </CardBody></Card>
          )}
          {tab === "documents" && (
            <Card><CardBody className="space-y-4">
              <AttachmentList items={r.attachments} showVisibility={katdict} />
              {((isMda && (r.status === "NEEDS_INFORMATION" || (r.status === "DRAFT" && r.createdBy.id === actor.id))) || (katdict && !terminal)) && (
                <FileUploader target={{ requestId: r.id }} allowInternal={katdict} />
              )}
            </CardBody></Card>
          )}
          {tab === "assessments" && (
            <div className="space-y-4">
              {r.assessments.length === 0 && <p className="text-sm text-muted">No assessments recorded.</p>}
              {r.assessments.map((a) => (
                <Card key={a.id}><CardHeader title={`${humanize(a.stage)} assessment`} description={`${a.assessor.name} · ${formatDateTime(a.createdAt)}`} /><CardBody>
                  <DescriptionList items={[["Findings", a.findings], ["Recommendation", a.recommendation], ["Recommended priority", a.recommendedPriority ? humanize(a.recommendedPriority) : null], ["Effort (days)", a.estimatedEffortDays], ["Cost", a.estimatedCostNgn ? formatNaira(a.estimatedCostNgn.toString()) : null], ["Proposed scope", a.proposedScope]]} />
                  {a.checklist && <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">{Object.entries(a.checklist as Record<string, boolean>).map(([k, v]) => <li key={k}>{v ? "☑" : "☐"} {k}</li>)}</ul>}
                </CardBody></Card>
              ))}
            </div>
          )}
          {tab === "trail" && <Card><CardBody><DecisionTrail actor={actor} requestId={r.id} /></CardBody></Card>}
        </div>

        <aside className="space-y-4">
          <Card><CardHeader title="Summary" /><CardBody className="space-y-2 text-sm">
            <p className="flex justify-between"><span className="text-muted">Status</span><StatusBadge status={r.status} /></p>
            <p className="flex justify-between"><span className="text-muted">Priority</span><StatusBadge status={r.priority ?? r.urgency} /></p>
            <p className="flex justify-between"><span className="text-muted">Submitted</span><span>{formatDateTime(r.submittedAt)}</span></p>
            <p className="flex justify-between"><span className="text-muted">Submitted by</span><span>{r.createdBy.name}</span></p>
            {r.assignedDepartment && <p className="flex justify-between"><span className="text-muted">Department</span><span>{r.assignedDepartment.name}</span></p>}
            {katdict && r.assessor && <p className="flex justify-between"><span className="text-muted">Assessor</span><span>{r.assessor.name}</span></p>}
            {sla && sla.state !== "NOT_APPLICABLE" && (
              <div className="border-t border-line pt-2">
                <p className="flex justify-between"><span className="text-muted">Assessment SLA</span><StatusBadge status={sla.state} /></p>
                <p className="text-xs text-muted">{sla.usedDays.toFixed(1)} of {sla.targetDays} working days used{sla.paused > 0 ? `; ${sla.paused.toFixed(1)} days paused awaiting MDA information` : ""}.</p>
              </div>
            )}
          </CardBody></Card>

          {r.status === "DRAFT" && r.createdBy.id === actor.id && (
            <Card><CardBody><ActionForm action={deleteDraftAction} submitLabel="Delete draft" submitVariant="danger" confirm="Delete this draft permanently?"><input type="hidden" name="id" value={r.id} /></ActionForm></CardBody></Card>
          )}

          {actions.map((a) => {
            const rule = REQUEST_TRANSITIONS[a];
            return (
              <Card key={a}><CardHeader title={rule.label} /><CardBody>
                <ActionForm action={transitionAction} submitLabel={rule.label} submitVariant={a === "reject" ? "danger" : a === "withdraw" || a === "defer" ? "secondary" : "primary"} confirm={a === "reject" || a === "withdraw" ? `${rule.label}? This cannot be undone.` : undefined}>
                  {(e) => (
                    <>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="version" value={r.version} />
                      <input type="hidden" name="action" value={a} />
                      {a === "accept_for_assessment" && (
                        <>
                          <Field label="Priority" name="priority" required error={e.priority}><Select defaultValue={r.priority ?? r.urgency}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
                          <Field label="Responsible department" name="assignedDepartmentId" required error={e.assignedDepartmentId}><Select defaultValue={r.assignedDepartment?.id ?? ""}><option value="">— Select —</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                          <Field label="Assessor (optional)" name="assessorId"><Select defaultValue=""><option value="">— Unassigned —</option>{officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
                        </>
                      )}
                      <Field label={a === "request_information" ? "Information requested" : a === "mda_respond" ? "Your response" : rule.reasonRequired ? "Reason" : "Note (optional)"} name="reason" required={rule.reasonRequired}><Textarea rows={3} /></Field>
                    </>
                  )}
                </ActionForm>
              </CardBody></Card>
            );
          })}

          {canAssess && (
            <Card><CardHeader title={`Record ${humanize(stage)} assessment`} /><CardBody>
              <ActionForm action={assessmentAction} submitLabel="Save assessment" resetOnSuccess>
                {(e) => (
                  <>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="stage" value={stage} />
                    {r.service.assessmentChecklist.length > 0 && (
                      <fieldset className="space-y-1 text-sm"><legend className="mb-1 font-medium">Assessment checklist</legend>
                        {r.service.assessmentChecklist.map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" name={`check:${c}`} /> {c}</label>)}
                      </fieldset>
                    )}
                    <Field label="Findings" name="findings" required error={e.findings}><Textarea rows={3} /></Field>
                    <Field label="Recommendation" name="recommendation"><Textarea rows={2} /></Field>
                    <Field label="Recommended priority" name="recommendedPriority"><Select defaultValue=""><option value="">—</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
                    {stage === "SCOPE" && (
                      <>
                        <Field label="Proposed scope" name="proposedScope" required error={e.proposedScope}><Textarea rows={4} defaultValue={r.proposedScope ?? ""} /></Field>
                        <Field label="Estimated effort (days)" name="estimatedEffortDays" required error={e.estimatedEffortDays}><Input type="number" min={1} defaultValue={r.estimatedEffortDays ?? ""} /></Field>
                        <Field label="Estimated cost (NGN)" name="estimatedCostNgn" error={e.estimatedCostNgn}><Input type="number" min={0} step="1000" defaultValue={r.estimatedCostNgn?.toString() ?? ""} /></Field>
                      </>
                    )}
                  </>
                )}
              </ActionForm>
            </CardBody></Card>
          )}

          {approval && approval.steps.length > 0 && (
            <Card><CardHeader title="Approval" description={`Cycle ${approval.cycle}`} /><CardBody className="space-y-3 text-sm">
              <ol className="space-y-1">
                {approval.steps.map((s) => {
                  const d = approval.decisions.find((x) => x.stepId === s.id);
                  const applies = approval.state.state === "no_steps" ? false : true;
                  return <li key={s.id} className="flex items-center justify-between gap-2"><span>{s.sequence}. {s.name}{!applies && " (n/a)"}</span>{d ? <StatusBadge status={d.outcome} /> : approval.state.state === "pending" && approval.state.nextStep.id === s.id ? <Badge tone="warning">Pending</Badge> : <span className="text-xs text-muted">{"completed" in approval.state && !approval.state.completed.some((c) => c.id === s.id) && approval.state.state !== "pending" ? "Not required" : "—"}</span>}</li>;
                })}
              </ol>
              {myApproval && approval.state.state === "pending" && (
                <ActionForm action={approvalAction} submitLabel="Record decision">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="version" value={r.version} />
                  <p className="font-medium">Your decision: {approval.state.nextStep.name}</p>
                  <Field label="Decision" name="outcome" required><Select defaultValue=""><option value="">— Choose —</option><option value="APPROVED">Approve</option><option value="RETURNED">Return for revision</option><option value="REJECTED">Reject</option></Select></Field>
                  <Field label="Reason / conditions" name="reason" hint="Required when returning or rejecting."><Textarea rows={2} /></Field>
                </ActionForm>
              )}
            </CardBody></Card>
          )}

          {r.status === "APPROVED" && can(actor, "project.create") && (
            <Card><CardHeader title="Project initiation" /><CardBody>
              <ActionForm action={initiateProjectAction} submitLabel="Initiate project" submitVariant="accent"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="version" value={r.version} /><p className="text-sm text-muted">Creates the project record and its digital passport.</p></ActionForm>
            </CardBody></Card>
          )}

          {katdict && canAny(actor, ["request.triage", "request.assess"]) && r.status !== "DRAFT" && (
            <Card><CardHeader title="AI assistance" description="Suggestions for staff review only" /><CardBody className="space-y-4">
              <AiPanel action={aiClassifyAction} id={r.id} label="Suggest classification" kind="classification" />
              <AiPanel action={aiQualityAction} id={r.id} label="Check request quality" kind="quality" />
            </CardBody></Card>
          )}
          {isMda && r.status === "DRAFT" && (
            <Card><CardHeader title="Quality check" /><CardBody><AiPanel action={aiQualityAction} id={r.id} label="Check completeness" kind="quality" /></CardBody></Card>
          )}
        </aside>
      </div>
    </>
  );
}
