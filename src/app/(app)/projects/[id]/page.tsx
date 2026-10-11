import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/modules/auth/current";
import { getProject } from "@/modules/projects/service";
import { canWorkOnProject } from "@/modules/projects/access";
import { availableProjectActions, PROJECT_TRANSITIONS } from "@/modules/projects/workflow";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { PageHeader, ProgressBar } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Field, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDate } from "@/lib/utils";
import { transitionProjectAction } from "../actions";
import { OverviewTab } from "./tab-overview";
import { PlanTab } from "./tab-plan";
import { TeamTab } from "./tab-team";
import { CommunicationsTab } from "./tab-communications";
import { RisksTab } from "./tab-risks";
import { ChangesTab } from "./tab-changes";
import { FilesTab } from "./tab-files";
import { CompletionTab } from "./tab-completion";
import { ReportTab } from "./tab-report";
import { DecisionTrail } from "@/components/shared/decision-trail";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requirePageActor();
  let data: Awaited<ReturnType<typeof getProject>>;
  try {
    data = await getProject(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { project: p, internal, isAssigned } = data;
  const canWork = await canWorkOnProject(prisma, actor, p);
  const isDeptHead = !!p.departmentId && actor.headOfDepartmentIds.includes(p.departmentId);
  const actions = actor.userType === "KATDICT_STAFF" ? availableProjectActions(p.status, { permissions: actor.permissions, isAssigned: isAssigned || isDeptHead }).filter((a) => a !== "close" && a !== "close_exceptional") : [];
  const tab = sp.tab ?? "overview";
  const tabs = [
    { key: "overview", label: "Passport" },
    { key: "plan", label: "Plan & progress", count: p.milestones.length },
    ...(internal ? [{ key: "team", label: "Team", count: p.assignments.filter((a) => ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"].includes(a.status)).length }] : []),
    { key: "communications", label: "Communications" },
    ...(internal ? [{ key: "risks", label: "Risks & blockers", count: (p.risks?.filter((r) => r.status === "OPEN").length ?? 0) + (p.blockers?.filter((b) => !b.resolvedAt).length ?? 0) }] : []),
    { key: "changes", label: "Change control", count: p.scopeChanges.length },
    { key: "files", label: "Deliverables & files", count: p.deliverables.length },
    { key: "completion", label: "Completion & acceptance" },
    ...(p.reports.length ? [{ key: "report", label: "Completion report" }] : []),
    { key: "trail", label: "Decision trail" },
  ];
  const props = { p, actor, internal, isAssigned, canWork, sp };
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: p.reference }]}
        title={<span className="flex flex-wrap items-center gap-3">{p.title} <StatusBadge status={p.status} /></span>}
        description={<>{p.reference} · {p.mda.name} · Request <Link href={`/requests/${p.request.id}`}>{p.request.reference}</Link></>}
      />
      <div className="mb-5 grid gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div><p className="text-xs uppercase tracking-wide text-muted">Progress</p><ProgressBar value={p.progressPercent} /></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Acceptance</p><StatusBadge status={p.acceptanceStatus} /></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Risk level</p><StatusBadge status={p.riskLevel} /></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Planned completion</p><p className={p.plannedEndDate && p.plannedEndDate < new Date() && !["CLOSED", "CANCELLED", "ACCEPTED"].includes(p.status) ? "font-semibold text-danger-700" : ""}>{formatDate(p.plannedEndDate)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Project manager</p><p>{p.projectManager?.name ?? "Not assigned"}</p></div>
      </div>
      {actions.length > 0 && (
        <Card className="mb-5"><CardHeader title="Project status actions" /><CardBody className="flex flex-wrap gap-4">
          {actions.map((a) => (
            <ActionForm key={a} action={transitionProjectAction} submitLabel={PROJECT_TRANSITIONS[a].label} submitVariant={a === "cancel" ? "danger" : a === "start_work" || a === "resume" ? "accent" : "secondary"} className="min-w-64 flex-1" confirm={a === "cancel" ? "Cancel this project?" : undefined}>
              <input type="hidden" name="projectId" value={p.id} />
              <input type="hidden" name="version" value={p.version} />
              <input type="hidden" name="action" value={a} />
              {PROJECT_TRANSITIONS[a].reasonRequired && <Field label="Reason" name="reason" required><Textarea rows={2} /></Field>}
            </ActionForm>
          ))}
        </CardBody></Card>
      )}
      <Tabs basePath={`/projects/${p.id}`} active={tab} tabs={tabs} />
      {tab === "overview" && <OverviewTab {...props} />}
      {tab === "plan" && <PlanTab {...props} />}
      {tab === "team" && internal && <TeamTab {...props} />}
      {tab === "communications" && <CommunicationsTab {...props} />}
      {tab === "risks" && internal && <RisksTab {...props} />}
      {tab === "changes" && <ChangesTab {...props} />}
      {tab === "files" && <FilesTab {...props} />}
      {tab === "completion" && <CompletionTab {...props} />}
      {tab === "report" && <ReportTab {...props} />}
      {tab === "trail" && <Card><CardBody><DecisionTrail actor={actor} projectId={p.id} /></CardBody></Card>}
    </>
  );
}
