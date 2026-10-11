import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { listProjects } from "@/modules/projects/service";
import { prisma } from "@/lib/db";
import { PageHeader, EmptyState, ProgressBar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { Pagination, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, humanize } from "@/lib/utils";

export const metadata = { title: "Projects" };
const STATUSES = ["APPROVED", "PLANNING", "AWAITING_ACKNOWLEDGMENT", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "BLOCKED", "UNDER_REVIEW", "AWAITING_MDA_ACCEPTANCE", "ACCEPTED", "CLOSED", "CANCELLED"];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActor();
  const katdict = actor.userType !== "MDA_USER";
  const [data, depts] = await Promise.all([
    listProjects(actor, { q: sp.q, status: sp.status, departmentId: sp.departmentId, mdaId: sp.mdaId, overdue: sp.overdue === "1", page: Number(sp.page ?? 1) }),
    katdict ? prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const now = new Date();
  return (
    <>
      <PageHeader title="Projects" description={katdict ? "Project directory within your access." : "Projects delivered for your MDA."} />
      <form method="get" className="mb-4 grid gap-2 rounded-[var(--radius-card)] border border-line bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input name="q" placeholder="Reference or title" defaultValue={sp.q} aria-label="Search" />
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        {depts.length > 0 && <Select name="departmentId" defaultValue={sp.departmentId ?? ""} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === "1"} /> Overdue only</label>
        <div className="flex gap-2"><Button type="submit" variant="secondary">Filter</Button><Button variant="ghost" asChild><Link href="/projects">Reset</Link></Button></div>
      </form>
      {data.items.length === 0 ? <EmptyState title="No projects found" /> : (
        <Table caption="Projects">
          <THead><tr><TH>Reference</TH><TH>Title</TH>{katdict && <TH>MDA</TH>}<TH>Status</TH><TH>Progress</TH><TH>Risk</TH><TH>Planned completion</TH>{katdict && <TH>Manager</TH>}</tr></THead>
          <tbody>{data.items.map((p) => (
            <TR key={p.id}>
              <TD className="whitespace-nowrap font-medium"><Link href={`/projects/${p.id}`}>{p.reference}</Link></TD>
              <TD className="max-w-xs">{p.title}</TD>
              {katdict && <TD>{p.mda.abbreviation}</TD>}
              <TD><StatusBadge status={p.status} /></TD>
              <TD className="min-w-32"><ProgressBar value={p.progressPercent} /></TD>
              <TD><StatusBadge status={p.riskLevel} /></TD>
              <TD className={`whitespace-nowrap ${p.plannedEndDate && p.plannedEndDate < now && !["CLOSED", "CANCELLED", "ACCEPTED"].includes(p.status) ? "font-semibold text-danger-700" : "text-muted"}`}>{formatDate(p.plannedEndDate)}</TD>
              {katdict && <TD className="text-muted">{p.projectManager?.name ?? "—"}</TD>}
            </TR>
          ))}</tbody>
        </Table>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/projects" params={sp} />
    </>
  );
}
