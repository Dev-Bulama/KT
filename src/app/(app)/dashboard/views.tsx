import Link from "next/link";
import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/rbac/actor";
import { can } from "@/modules/rbac/authorize";
import { projectScope, requestScope } from "@/modules/rbac/scope";
import { departmentBacklog, monthlyTrends, officerWorkload, overview, requestsByCategory, scorecard, overdueProjectWhere } from "@/modules/analytics/metrics";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatCard, EmptyState, ProgressBar } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { TrendChart } from "@/components/charts/trend-chart";
import { BarList } from "@/components/charts/bar-list";
import { formatDate, formatDateTime } from "@/lib/utils";

export interface Range { from?: Date; to?: Date }

export async function ExecutiveView({ actor, range }: { actor: Actor; range: Range }) {
  const [ov, trends, backlog, cats, sc] = await Promise.all([overview(actor, range), monthlyTrends(actor, 12), departmentBacklog(actor), requestsByCategory(actor, range), scorecard(actor, range)]);
  const sla = sc.find((m) => m.key === "median_review_time");
  const onTime = sc.find((m) => m.key === "on_time_rate");
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Registered MDAs" value={ov.totalMdas} hint={`${ov.activeMdas} active`} href="/mdas" />
        <StatCard label="Total requests" value={ov.totalRequests} href="/requests" />
        <StatCard label="Awaiting review" value={ov.awaitingReview} href="/requests?status=SUBMITTED" tone={ov.awaitingReview ? "warning" : undefined} />
        <StatCard label="Approved" value={ov.approved} />
        <StatCard label="Active projects" value={ov.activeProjects} href="/projects" />
        <StatCard label="Completed projects" value={ov.completedProjects} href="/projects?status=CLOSED" tone="success" />
        <StatCard label="Overdue projects" value={ov.overdueProjects} href="/projects?overdue=1" tone={ov.overdueProjects ? "danger" : undefined} />
        <StatCard label="High-risk projects" value={ov.highRiskProjects} href="/early-warning" tone={ov.highRiskProjects ? "danger" : undefined} />
        <StatCard label="Median review time" value={sla?.value ?? "—"} hint="working days" href="/intelligence" />
        <StatCard label="On-time completion" value={onTime?.value !== null && onTime?.value !== undefined ? `${onTime.value}%` : "—"} hint={`${onTime?.sampleSize ?? 0} projects`} href="/intelligence" />
        <StatCard label="MDA satisfaction" value={ov.satisfaction ?? "—"} hint={`${ov.satisfactionResponses} ratings · out of 5`} />
        <StatCard label="AI briefing" value="Open" hint="Facts + interpretation" href="/intelligence?tab=briefing" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader title="Monthly trends" description="Requests submitted and projects completed (last 12 months)" /><CardBody><TrendChart data={trends} /></CardBody></Card>
        <Card><CardHeader title="Requests by service category" /><CardBody><BarList items={cats.slice(0, 8).map((c) => ({ label: c.category, value: c.count, href: `/requests?categoryId=${c.categoryId}` }))} /></CardBody></Card>
      </div>
      <Card>
        <CardHeader title="Departmental workload" description="Open projects, overdue projects and requests in assessment" />
        <Table caption="Departmental workload">
          <THead><tr><TH>Department</TH><TH className="text-right">Active projects</TH><TH className="text-right">Overdue</TH><TH className="text-right">Pending requests</TH></tr></THead>
          <tbody>{backlog.map((d) => (
            <TR key={d.department}><TD>{d.departmentId ? <Link href={`/projects?departmentId=${d.departmentId}`}>{d.department}</Link> : d.department}</TD><TD className="text-right tabular-nums">{d.activeProjects}</TD><TD className={`text-right tabular-nums ${d.overdueProjects ? "font-semibold text-danger-700" : ""}`}>{d.overdueProjects}</TD><TD className="text-right tabular-nums">{d.pendingRequests}</TD></TR>
          ))}</tbody>
        </Table>
      </Card>
    </div>
  );
}

export async function OperationsView({ actor }: { actor: Actor }) {
  const rs = requestScope(actor);
  const ps = projectScope(actor);
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400000);
  const [submitted, triage, technical, approval, unassigned, unacked, blocked, upcoming, overdue, decisions, escalations] = await Promise.all([
    prisma.serviceRequest.count({ where: { AND: [rs, { status: "SUBMITTED" }] } }),
    prisma.serviceRequest.count({ where: { AND: [rs, { status: "INITIAL_TRIAGE" }] } }),
    prisma.serviceRequest.count({ where: { AND: [rs, { status: "TECHNICAL_EVALUATION" }] } }),
    prisma.serviceRequest.count({ where: { AND: [rs, { status: "APPROVAL_REVIEW" }] } }),
    prisma.project.count({ where: { AND: [ps, { status: { in: ["APPROVED", "PLANNING"] } }] } }),
    prisma.projectAssignment.count({ where: { status: "PENDING_ACKNOWLEDGMENT", project: ps } }),
    prisma.project.count({ where: { AND: [ps, { status: "BLOCKED" }] } }),
    prisma.project.findMany({ where: { AND: [ps, { plannedEndDate: { gte: now, lte: soon }, status: { notIn: ["CLOSED", "CANCELLED", "ACCEPTED"] } }] }, select: { id: true, reference: true, title: true, plannedEndDate: true, progressPercent: true }, orderBy: { plannedEndDate: "asc" }, take: 6 }),
    prisma.project.count({ where: { AND: [ps, overdueProjectWhere()] } }),
    prisma.requestStatusHistory.findMany({ where: { request: rs, toStatus: { in: ["APPROVED", "REJECTED", "DEFERRED", "RETURNED_FOR_REVISION"] } }, orderBy: { createdAt: "desc" }, take: 6, include: { request: { select: { id: true, reference: true, title: true } }, actor: { select: { name: true } } } }),
    prisma.complaint.count({ where: { status: "ESCALATED" } }),
  ]);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="New submissions" value={submitted} href="/requests?status=SUBMITTED" tone={submitted ? "warning" : undefined} />
        <StatCard label="In triage" value={triage} href="/requests?status=INITIAL_TRIAGE" />
        <StatCard label="Technical review" value={technical} href="/requests?status=TECHNICAL_EVALUATION" />
        <StatCard label="Awaiting approval" value={approval} href="/approvals" />
        <StatCard label="Unassigned projects" value={unassigned} href="/projects?status=PLANNING" tone={unassigned ? "warning" : undefined} />
        <StatCard label="Unacknowledged assignments" value={unacked} href="/early-warning" tone={unacked ? "warning" : undefined} />
        <StatCard label="Blocked projects" value={blocked} href="/projects?status=BLOCKED" tone={blocked ? "danger" : undefined} />
        <StatCard label="Overdue projects" value={overdue} href="/projects?overdue=1" tone={overdue ? "danger" : undefined} />
        <StatCard label="Escalated complaints" value={escalations} href="/feedback?tab=complaints" tone={escalations ? "danger" : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Upcoming deadlines" description="Planned completion in the next 7 days" /><CardBody>
          {upcoming.length ? <ul className="space-y-3">{upcoming.map((p) => <li key={p.id} className="text-sm"><div className="flex justify-between gap-2"><Link href={`/projects/${p.id}`}>{p.reference} — {p.title}</Link><span className="text-muted">{formatDate(p.plannedEndDate)}</span></div><ProgressBar value={p.progressPercent} /></li>)}</ul> : <p className="text-sm text-muted">No deadlines in the next 7 days.</p>}
        </CardBody></Card>
        <Card><CardHeader title="Recent decisions" /><CardBody>
          {decisions.length ? <ul className="space-y-2 text-sm">{decisions.map((d) => <li key={String(d.id)} className="flex flex-wrap items-center justify-between gap-2"><Link href={`/requests/${d.request.id}`}>{d.request.reference}</Link><StatusBadge status={d.toStatus} /><span className="text-xs text-muted">{d.actor?.name ?? "System"} · {formatDateTime(d.createdAt)}</span></li>)}</ul> : <p className="text-sm text-muted">No decisions recorded yet.</p>}
        </CardBody></Card>
      </div>
    </div>
  );
}

export async function DepartmentView({ actor }: { actor: Actor }) {
  const deptId = actor.headOfDepartmentIds[0] ?? actor.departmentId;
  if (!deptId) return <EmptyState title="No department linked to your account" description="Ask an administrator to set your department." />;
  const ps = { AND: [projectScope(actor), { departmentId: deptId }] };
  const [dept, workload, assigned, pendingAssign, milestones, risks, overdueDeliverables, sc] = await Promise.all([
    prisma.department.findUnique({ where: { id: deptId }, select: { name: true } }),
    officerWorkload(actor, deptId),
    prisma.serviceRequest.findMany({ where: { AND: [requestScope(actor), { assignedDepartmentId: deptId, status: { in: ["UNDER_ASSESSMENT", "TECHNICAL_EVALUATION", "SCOPE_ESTIMATION", "APPROVAL_REVIEW"] } }] }, select: { id: true, reference: true, title: true, status: true }, take: 10 }),
    prisma.project.findMany({ where: { AND: [ps, { status: { in: ["APPROVED", "PLANNING"] } }] }, select: { id: true, reference: true, title: true }, take: 10 }),
    prisma.projectMilestone.groupBy({ by: ["status"], where: { project: ps }, _count: { _all: true } }),
    prisma.projectRisk.findMany({ where: { status: "OPEN", project: ps }, select: { id: true, title: true, likelihood: true, impact: true, project: { select: { id: true, reference: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.projectMilestone.count({ where: { project: ps, dueDate: { lt: new Date() }, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
    scorecard(actor, {}, { departmentId: deptId }),
  ]);
  const done = milestones.find((m) => m.status === "COMPLETED")?._count._all ?? 0;
  const total = milestones.filter((m) => m.status !== "CANCELLED").reduce((s, m) => s + m._count._all, 0);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">Department: <strong className="text-ink">{dept?.name}</strong></p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Requests in assessment" value={assigned.length} />
        <StatCard label="Pending assignment" value={pendingAssign.length} tone={pendingAssign.length ? "warning" : undefined} />
        <StatCard label="Milestones completed" value={`${done}/${total}`} />
        <StatCard label="Overdue milestones" value={overdueDeliverables} tone={overdueDeliverables ? "danger" : undefined} href="/early-warning" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Officer workload" description="Active project assignments against recorded capacity" />
          <Table caption="Officer workload"><THead><tr><TH>Officer</TH><TH className="text-right">Active</TH><TH className="text-right">Pending ack.</TH><TH className="text-right">Overdue tasks</TH></tr></THead>
            <tbody>{workload.map((o) => <TR key={o.id}><TD>{o.name}</TD><TD className="text-right tabular-nums">{o.activeAssignments}/{o.capacity}</TD><TD className="text-right tabular-nums">{o.pendingAcknowledgements}</TD><TD className="text-right tabular-nums">{o.overdueTasks}</TD></TR>)}
              {!workload.length && <TR><TD colSpan={4} className="text-muted">No officers in this department.</TD></TR>}</tbody></Table>
        </Card>
        <Card><CardHeader title="Pending assignment" /><CardBody>{pendingAssign.length ? <ul className="space-y-1 text-sm">{pendingAssign.map((p) => <li key={p.id}><Link href={`/projects/${p.id}?tab=team`}>{p.reference} — {p.title}</Link></li>)}</ul> : <p className="text-sm text-muted">Nothing awaiting assignment.</p>}</CardBody></Card>
        <Card><CardHeader title="Requests assigned to the department" /><CardBody>{assigned.length ? <ul className="space-y-2 text-sm">{assigned.map((r) => <li key={r.id} className="flex justify-between gap-2"><Link href={`/requests/${r.id}`}>{r.reference} — {r.title}</Link><StatusBadge status={r.status} /></li>)}</ul> : <p className="text-sm text-muted">None.</p>}</CardBody></Card>
        <Card><CardHeader title="Open project risks" /><CardBody>{risks.length ? <ul className="space-y-2 text-sm">{risks.map((r) => <li key={r.id} className="flex justify-between gap-2"><Link href={`/projects/${r.project.id}?tab=risks`}>{r.project.reference}: {r.title}</Link><span className="tabular-nums text-muted">score {r.likelihood * r.impact}</span></li>)}</ul> : <p className="text-sm text-muted">No open risks.</p>}</CardBody></Card>
      </div>
      <Card><CardHeader title="Department performance" description="See Intelligence for metric definitions" /><CardBody><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{sc.slice(0, 8).map((m) => <StatCard key={m.key} label={m.label} value={m.value ?? "—"} hint={`${m.unit} · n=${m.sampleSize}`} />)}</div></CardBody></Card>
    </div>
  );
}

export async function OfficerView({ actor }: { actor: Actor }) {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400000);
  const [assignments, tasks, projects, blockers, comments, milestones] = await Promise.all([
    prisma.projectAssignment.findMany({ where: { assigneeId: actor.id, status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] }, project: { status: { notIn: ["CLOSED", "CANCELLED"] } } }, include: { project: { select: { id: true, reference: true, title: true, status: true, progressPercent: true } } }, orderBy: { assignedAt: "desc" } }),
    prisma.projectTask.findMany({ where: { assigneeId: actor.id, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } }, include: { project: { select: { id: true, reference: true } } }, orderBy: { dueDate: "asc" }, take: 20 }),
    prisma.project.count({ where: { AND: [projectScope(actor), { status: "IN_PROGRESS" }] } }),
    prisma.projectBlocker.findMany({ where: { resolvedAt: null, project: { OR: [{ projectManagerId: actor.id }, { assignments: { some: { assigneeId: actor.id, status: { in: ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"] } } } }] } }, include: { project: { select: { id: true, reference: true } } }, take: 10 }),
    prisma.projectComment.findMany({ where: { authorId: { not: actor.id }, project: { OR: [{ projectManagerId: actor.id }, { assignments: { some: { assigneeId: actor.id } } }] } }, include: { author: { select: { name: true } }, project: { select: { id: true, reference: true } } }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.projectMilestone.findMany({ where: { status: { in: ["PENDING", "IN_PROGRESS"] }, dueDate: { lte: soon }, project: { OR: [{ projectManagerId: actor.id }, { assignments: { some: { assigneeId: actor.id, status: "ACKNOWLEDGED" } } }] } }, include: { project: { select: { id: true, reference: true } } }, orderBy: { dueDate: "asc" }, take: 10 }),
  ]);
  const pending = assignments.filter((a) => a.status === "PENDING_ACKNOWLEDGMENT");
  const dueSoon = tasks.filter((t) => t.dueDate && t.dueDate >= now && t.dueDate <= soon);
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < now);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="My assignments" value={assignments.length} />
        <StatCard label="Pending acknowledgement" value={pending.length} tone={pending.length ? "warning" : undefined} />
        <StatCard label="Projects in progress" value={projects} href="/projects?status=IN_PROGRESS" />
        <StatCard label="Tasks due in 7 days" value={dueSoon.length} />
        <StatCard label="Overdue tasks" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="My assignments" /><CardBody>
          {assignments.length ? <ul className="space-y-3 text-sm">{assignments.map((a) => <li key={a.id}><div className="flex flex-wrap justify-between gap-2"><Link href={`/projects/${a.project.id}`}>{a.project.reference} — {a.project.title}</Link><StatusBadge status={a.status} /></div><ProgressBar value={a.project.progressPercent} /></li>)}</ul> : <p className="text-sm text-muted">No active assignments.</p>}
        </CardBody></Card>
        <Card><CardHeader title="My open tasks" /><CardBody>
          {tasks.length ? <ul className="space-y-2 text-sm">{tasks.map((t) => <li key={t.id} className="flex justify-between gap-2"><Link href={`/projects/${t.project.id}?tab=plan`}>{t.project.reference}: {t.title}</Link><span className={t.dueDate && t.dueDate < now ? "font-medium text-danger-700" : "text-muted"}>{formatDate(t.dueDate)}</span></li>)}</ul> : <p className="text-sm text-muted">No open tasks assigned to you.</p>}
        </CardBody></Card>
        <Card><CardHeader title="Upcoming milestones" /><CardBody>
          {milestones.length ? <ul className="space-y-2 text-sm">{milestones.map((m) => <li key={m.id} className="flex justify-between gap-2"><Link href={`/projects/${m.project.id}?tab=plan`}>{m.project.reference}: {m.title}</Link><span className={m.dueDate && m.dueDate < now ? "font-medium text-danger-700" : "text-muted"}>{formatDate(m.dueDate)}</span></li>)}</ul> : <p className="text-sm text-muted">None due in the next 7 days.</p>}
        </CardBody></Card>
        <Card><CardHeader title="Blockers and recent messages" /><CardBody className="space-y-3 text-sm">
          {blockers.map((b) => <p key={b.id}><span className="font-medium text-danger-700">Blocker</span> · <Link href={`/projects/${b.project.id}?tab=risks`}>{b.project.reference}</Link>: {b.description}</p>)}
          {comments.map((c) => <p key={c.id}><Link href={`/projects/${c.project.id}?tab=communications`}>{c.project.reference}</Link> · {c.author.name}: <span className="text-muted">{c.body.slice(0, 120)}</span></p>)}
          {!blockers.length && !comments.length && <p className="text-muted">Nothing new.</p>}
        </CardBody></Card>
      </div>
    </div>
  );
}

export async function MdaView({ actor }: { actor: Actor }) {
  if (actor.mdaStatus !== "ACTIVE") {
    return <EmptyState title={`Your MDA account is ${actor.mdaStatus?.toLowerCase().replace(/_/g, " ") ?? "not linked"}`} description="Open My MDA to see the registration status and next steps." action={<Link href="/my-mda">Go to My MDA</Link>} />;
  }
  const rs = requestScope(actor);
  const ps = projectScope(actor);
  const [byStatus, active, awaitingAcceptance, upcoming, closed, feedback, recent] = await Promise.all([
    prisma.serviceRequest.groupBy({ by: ["status"], where: { AND: [rs, { status: { not: "DRAFT" } }] }, _count: { _all: true } }),
    prisma.project.findMany({ where: { AND: [ps, { status: { notIn: ["CLOSED", "CANCELLED"] } }] }, select: { id: true, reference: true, title: true, status: true, progressPercent: true, plannedEndDate: true }, orderBy: { updatedAt: "desc" }, take: 8 }),
    prisma.project.findMany({ where: { AND: [ps, { status: "AWAITING_MDA_ACCEPTANCE" }] }, select: { id: true, reference: true, title: true } }),
    prisma.projectMilestone.findMany({ where: { visibleToMda: true, status: { in: ["PENDING", "IN_PROGRESS"] }, project: ps }, select: { id: true, title: true, dueDate: true, project: { select: { id: true, reference: true } } }, orderBy: { dueDate: "asc" }, take: 6 }),
    prisma.project.count({ where: { AND: [ps, { status: "CLOSED" }] } }),
    prisma.feedback.count({ where: { mdaId: actor.mdaId! } }),
    prisma.serviceRequest.findMany({ where: { AND: [rs] }, select: { id: true, reference: true, title: true, status: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
  ]);
  const c = (s: string[]) => byStatus.filter((b) => s.includes(b.status)).reduce((n, b) => n + b._count._all, 0);
  return (
    <div className="space-y-6">
      {awaitingAcceptance.length > 0 && (
        <Card className="border-amber-300"><CardBody>
          <p className="font-semibold text-warn-700">Completion acceptance needed</p>
          <ul className="mt-2 space-y-1 text-sm">{awaitingAcceptance.map((p) => <li key={p.id}><Link href={`/projects/${p.id}?tab=completion`}>{p.reference} — {p.title}: review deliverables and accept or dispute</Link></li>)}</ul>
        </CardBody></Card>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Requests submitted" value={c(byStatus.map((b) => b.status))} href="/requests" />
        <StatCard label="Awaiting your clarification" value={c(["NEEDS_INFORMATION"])} href="/requests?status=NEEDS_INFORMATION" tone={c(["NEEDS_INFORMATION"]) ? "warning" : undefined} />
        <StatCard label="Approved" value={c(["APPROVED", "PROJECT_INITIATED"])} />
        <StatCard label="Active projects" value={active.length} href="/projects" />
        <StatCard label="Closed projects" value={closed} href="/projects?status=CLOSED" tone="success" />
        <StatCard label="Feedback given" value={feedback} href="/feedback" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Project progress" actions={<Link href="/requests/new" className="text-sm">New request</Link>} /><CardBody>
          {active.length ? <ul className="space-y-3 text-sm">{active.map((p) => <li key={p.id}><div className="flex flex-wrap justify-between gap-2"><Link href={`/projects/${p.id}`}>{p.reference} — {p.title}</Link><StatusBadge status={p.status} /></div><ProgressBar value={p.progressPercent} /></li>)}</ul> : <p className="text-sm text-muted">No active projects.</p>}
        </CardBody></Card>
        <Card><CardHeader title="Upcoming milestones" /><CardBody>
          {upcoming.length ? <ul className="space-y-2 text-sm">{upcoming.map((m) => <li key={m.id} className="flex justify-between gap-2"><Link href={`/projects/${m.project.id}`}>{m.project.reference}: {m.title}</Link><span className="text-muted">{formatDate(m.dueDate)}</span></li>)}</ul> : <p className="text-sm text-muted">No upcoming milestones.</p>}
        </CardBody></Card>
        <Card className="lg:col-span-2"><CardHeader title="Recent request activity" /><CardBody>
          {recent.length ? <ul className="space-y-2 text-sm">{recent.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2"><Link href={`/requests/${r.id}`}>{r.reference ?? "Draft"} — {r.title}</Link><span className="flex items-center gap-2"><StatusBadge status={r.status} /><span className="text-xs text-muted">{formatDate(r.updatedAt)}</span></span></li>)}</ul> : <EmptyState title="No requests yet" action={can(actor, "request.create") ? <Link href="/requests/new">Submit your first request</Link> : undefined} />}
        </CardBody></Card>
      </div>
    </div>
  );
}
