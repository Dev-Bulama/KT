import Link from "next/link";
import { requirePageActorAny } from "@/modules/auth/current";
import { can, canAny } from "@/modules/rbac/authorize";
import { demandByCategoryAndQuarter, mdaIntelligence, officerWorkload, scorecard } from "@/modules/analytics/metrics";
import { recurringNeeds, sharedSolutionOpportunities } from "@/modules/intelligence/service";
import { PageHeader, StatCard, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { BarList } from "@/components/charts/bar-list";
import { StatusBadge } from "@/components/ui/badge";
import { BriefingPanel } from "./briefing-panel";
import { briefingAction } from "./actions";

export const metadata = { title: "Intelligence" };

export default async function Intelligence({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActorAny(["analytics.executive", "analytics.operations", "analytics.department"]);
  const tabs = [
    { key: "scorecard", label: "Service delivery scorecard" },
    { key: "map", label: "Statewide ICT map" },
    { key: "shared", label: "Shared solutions" },
    { key: "demand", label: "Capacity & demand" },
    ...(can(actor, "ai.briefing") ? [{ key: "briefing", label: "Executive briefing" }] : []),
  ];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "scorecard";
  const range = { from: sp.from ? new Date(sp.from) : undefined, to: sp.to ? new Date(`${sp.to}T23:59:59Z`) : undefined };
  return (
    <>
      <PageHeader title="Delivery intelligence" description="Aggregated, permission-scoped analysis of ICT demand and delivery. Analytical findings are kept separate from personnel evaluation." />
      <Tabs basePath="/intelligence" active={tab} tabs={tabs} />
      {tab === "scorecard" && <ScorecardTab actor={actor} range={range} sp={sp} />}
      {tab === "map" && <MapTab actor={actor} />}
      {tab === "shared" && <SharedTab actor={actor} />}
      {tab === "demand" && <DemandTab actor={actor} />}
      {tab === "briefing" && <BriefingPanel action={briefingAction} />}
    </>
  );
}

async function ScorecardTab({ actor, range, sp }: { actor: Parameters<typeof scorecard>[0]; range: { from?: Date; to?: Date }; sp: Record<string, string | undefined> }) {
  const sc = await scorecard(actor, range);
  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm"><input type="hidden" name="tab" value="scorecard" />
        <label className="flex flex-col">From<input type="date" name="from" defaultValue={sp.from} className="h-9 rounded-md border border-line px-2" /></label>
        <label className="flex flex-col">To<input type="date" name="to" defaultValue={sp.to} className="h-9 rounded-md border border-line px-2" /></label>
        <button className="h-9 rounded-md border border-line bg-white px-3">Apply</button>
      </form>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sc.map((m) => (
          <Card key={m.key}><CardBody>
            <StatCard label={m.label} value={m.value === null ? "—" : `${m.value}${m.unit === "%" ? "%" : ""}`} hint={`${m.unit !== "%" ? m.unit + " · " : ""}sample: ${m.sampleSize}`} />
            <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">How is this calculated?</summary><p className="mt-1">{m.definition}</p></details>
          </CardBody></Card>
        ))}
      </div>
      <p className="text-xs text-muted">Rankings between departments are deliberately not shown: departments handle work of different complexity, and raw comparisons would be misleading.</p>
    </div>
  );
}

async function MapTab({ actor }: { actor: Parameters<typeof mdaIntelligence>[0] }) {
  const rows = await mdaIntelligence(actor);
  if (!rows.length) return <EmptyState title="No active MDAs in your scope" />;
  const max = Math.max(1, ...rows.map((r) => r.requests));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Each tile is an MDA; shading shows request volume, the bar shows completion rate. No geographic coordinates are assumed — a geographic map can be added once verified location data exists.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((m) => {
          const shade = 0.08 + (m.requests / max) * 0.5;
          return (
            <Link key={m.id} href={`/mdas/${m.id}`} className="block rounded-[var(--radius-card)] border border-line p-3 text-sm text-ink no-underline hover:border-navy-700" style={{ backgroundColor: `rgba(47,98,184,${shade})` }}>
              <p className="font-semibold">{m.abbreviation}</p>
              <p className="truncate text-xs" title={m.name}>{m.name}</p>
              <dl className="mt-2 grid grid-cols-3 gap-1 text-xs">
                <div><dt className="text-muted">Requests</dt><dd className="font-semibold">{m.requests}</dd></div>
                <div><dt className="text-muted">Open</dt><dd className="font-semibold">{m.openRequests}</dd></div>
                <div><dt className="text-muted">Overdue</dt><dd className={`font-semibold ${m.overdueProjects ? "text-danger-700" : ""}`}>{m.overdueProjects}</dd></div>
              </dl>
              <div className="mt-2 h-1.5 rounded-full bg-white/70"><div className="h-full rounded-full bg-[#128052]" style={{ width: `${m.completionRate ?? 0}%` }} /></div>
              <p className="mt-0.5 text-[10px] text-muted">Completion {m.completionRate === null ? "n/a" : `${m.completionRate}%`} ({m.closedProjects}/{m.projects})</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

async function SharedTab({ actor }: { actor: Parameters<typeof sharedSolutionOpportunities>[0] }) {
  const [ops, needs] = await Promise.all([sharedSolutionOpportunities(actor), recurringNeeds(actor)]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <p className="text-sm text-muted">Groups of similar requests from different MDAs that may justify a feasibility assessment for a reusable statewide solution. Similarity is a text-based indicator and requires technical and administrative assessment — no procurement decision is implied.</p>
        {ops.length === 0 ? <EmptyState title="No cross-MDA patterns detected" /> : ops.map((o, i) => (
          <Card key={i}><CardHeader title={`Opportunity: ${o.commonTerms.slice(0, 4).join(", ") || "similar needs"}`} description={o.evidence} /><CardBody>
            <ul className="space-y-1 text-sm">{o.requests.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2"><Link href={`/requests/${r.id}`}>{r.reference} — {r.title}</Link><span className="flex items-center gap-2 text-xs text-muted">{r.mda}<StatusBadge status={r.status} /></span></li>)}</ul>
            <p className="mt-2 text-xs text-muted">Potential benefit (indicative): {o.combinedEstimatedEffortDays ? `${o.combinedEstimatedEffortDays} days of separately estimated effort could be partly consolidated.` : "effort not yet estimated for these requests."}</p>
          </CardBody></Card>
        ))}
      </div>
      <Card><CardHeader title="Recurring service needs" description="Open and recently approved requests" /><CardBody><BarList items={needs.map((n) => ({ label: n.service, value: n.count }))} /></CardBody></Card>
    </div>
  );
}

async function DemandTab({ actor }: { actor: Parameters<typeof demandByCategoryAndQuarter>[0] }) {
  const [demand, workload] = await Promise.all([demandByCategoryAndQuarter(actor, 4), officerWorkload(actor)]);
  return (
    <div className="space-y-6">
      <Card><CardHeader title="Demand by category and quarter" description="Requests submitted and estimated effort (where scoped)" />
        <Table caption="Demand"><THead><tr><TH>Quarter</TH><TH>Category</TH><TH className="text-right">Requests</TH><TH className="text-right">Estimated effort (days)</TH></tr></THead>
          <tbody>{demand.map((d) => <TR key={`${d.quarter}-${d.category}`}><TD>{d.quarter}</TD><TD>{d.category}</TD><TD className="text-right tabular-nums">{d.count}</TD><TD className="text-right tabular-nums">{d.effortDays || "—"}</TD></TR>)}{!demand.length && <TR><TD colSpan={4} className="text-muted">No requests in the period.</TD></TR>}</tbody></Table>
      </Card>
      <Card><CardHeader title="Officer capacity" description="Recorded workload against recorded capacity — for staffing discussions, not performance evaluation." />
        <Table caption="Capacity"><THead><tr><TH>Officer</TH><TH>Department</TH><TH>Skills</TH><TH className="text-right">Active / capacity</TH><TH className="text-right">Open tasks</TH><TH className="text-right">Utilisation</TH></tr></THead>
          <tbody>{workload.map((o) => <TR key={o.id}><TD>{o.name}</TD><TD>{o.department}</TD><TD className="text-xs text-muted">{o.skills.join(", ") || "—"}</TD><TD className="text-right tabular-nums">{o.activeAssignments}/{o.capacity}</TD><TD className="text-right tabular-nums">{o.openTasks}</TD><TD className="text-right tabular-nums">{o.utilisation ?? "—"}%</TD></TR>)}</tbody></Table>
      </Card>
    </div>
  );
}
