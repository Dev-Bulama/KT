import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { earlyWarnings } from "@/modules/quality/early-warning";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, humanize } from "@/lib/utils";

export const metadata = { title: "Early Warning Centre" };

function Section({ title, description, count, children }: { title: string; description?: string; count: number; children: React.ReactNode }) {
  return (
    <Card><CardHeader title={<span className="flex items-center gap-2">{title}<Badge tone={count ? "warning" : "success"}>{count}</Badge></span>} description={description} /><CardBody>{count ? children : <p className="text-sm text-muted">Nothing to report.</p>}</CardBody></Card>
  );
}

export default async function EarlyWarning() {
  const actor = await requirePageActor("earlywarning.view");
  const w = await earlyWarnings(actor);
  return (
    <>
      <PageHeader title="Early Warning Centre" description="Live signals that need attention. Thresholds are configurable in System settings (workflow and calendar)." actions={can(actor, "escalation.configure") ? <Link href="/admin/settings">Configure escalation rules</Link> : undefined} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Overdue milestones" value={w.overdueMilestones.length} tone={w.overdueMilestones.length ? "danger" : undefined} />
        <StatCard label="Deadlines approaching" value={w.approaching.length} tone={w.approaching.length ? "warning" : undefined} />
        <StatCard label="Unacknowledged" value={w.unacknowledged.length} tone={w.unacknowledged.length ? "warning" : undefined} />
        <StatCard label="Awaiting clarification" value={w.awaitingClarification.length} />
        <StatCard label="SLA at risk / breached" value={w.slaBreaches.length} tone={w.slaBreaches.length ? "danger" : undefined} />
        <StatCard label="Repeated scope changes" value={w.scopeChurn.length} />
        <StatCard label="High-risk projects" value={w.highRisk.length} tone={w.highRisk.length ? "danger" : undefined} />
        <StatCard label="Unresolved complaints" value={w.complaints.length} tone={w.complaints.length ? "warning" : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="High-risk projects" description="Explainable rule flags" count={w.highRisk.length}>
          <ul className="space-y-3 text-sm">{w.highRisk.map((p) => <li key={p.id}><div className="flex justify-between gap-2"><Link href={`/projects/${p.id}?tab=risks`}>{p.reference} — {p.title}</Link><StatusBadge status={p.level} /></div><ul className="ml-4 list-disc text-xs text-muted">{p.flags.map((f) => <li key={f.code}>{f.message}</li>)}</ul></li>)}</ul>
        </Section>
        <Section title="Requests exceeding service-level targets" description="Working days, excluding time awaiting the MDA" count={w.slaBreaches.length}>
          <ul className="space-y-2 text-sm">{w.slaBreaches.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2"><Link href={`/requests/${r.id}`}>{r.reference} — {r.title}</Link><span className="flex items-center gap-2"><StatusBadge status={r.sla.state} /><span className="text-xs text-muted">{r.sla.usedDays.toFixed(1)}/{r.sla.targetDays} d{r.pausedDays ? ` (+${r.pausedDays} paused)` : ""}</span></span></li>)}</ul>
        </Section>
        <Section title="Overdue milestones" count={w.overdueMilestones.length}>
          <ul className="space-y-1 text-sm">{w.overdueMilestones.map((m) => <li key={m.id} className="flex justify-between gap-2"><Link href={`/projects/${m.project.id}?tab=plan`}>{m.project.reference}: {m.title}</Link><span className="text-danger-700">{formatDate(m.dueDate)}</span></li>)}</ul>
        </Section>
        <Section title="Projects approaching deadline" count={w.approaching.length}>
          <ul className="space-y-1 text-sm">{w.approaching.map((p) => <li key={p.id} className="flex justify-between gap-2"><Link href={`/projects/${p.id}`}>{p.reference} — {p.title}</Link><span className="text-muted">{formatDate(p.plannedEndDate)} · {p.progressPercent}%</span></li>)}</ul>
        </Section>
        <Section title="Unacknowledged assignments" count={w.unacknowledged.length}>
          <ul className="space-y-1 text-sm">{w.unacknowledged.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2"><Link href={`/projects/${a.project.id}?tab=team`}>{a.project.reference}: {a.assignee.name} ({humanize(a.role)})</Link><span className="text-xs text-muted">due {formatDateTime(a.expectedAckBy)}{a.escalatedAt ? " · escalated" : ""}</span></li>)}</ul>
        </Section>
        <Section title="Requests awaiting MDA clarification" count={w.awaitingClarification.length}>
          <ul className="space-y-1 text-sm">{w.awaitingClarification.map((r) => <li key={r.id} className="flex justify-between gap-2"><Link href={`/requests/${r.id}`}>{r.reference} ({r.mda.abbreviation})</Link><span className={r.escalate ? "text-danger-700" : "text-muted"}>{r.waitingDays ?? "?"} days waiting</span></li>)}</ul>
        </Section>
        <Section title="Projects with repeated scope changes" count={w.scopeChurn.length}>
          <ul className="space-y-1 text-sm">{w.scopeChurn.map((p) => <li key={p.id}><Link href={`/projects/${p.id}?tab=changes`}>{p.reference} — {p.title}</Link> <span className="text-muted">({p._count.scopeChanges})</span></li>)}</ul>
        </Section>
        <Section title="Unresolved complaints" count={w.complaints.length}>
          <ul className="space-y-1 text-sm">{w.complaints.map((c) => <li key={c.id} className="flex justify-between gap-2"><Link href={`/complaints/${c.id}`}>{c.reference}: {c.subject}</Link><StatusBadge status={c.status} /></li>)}</ul>
        </Section>
      </div>
    </>
  );
}
