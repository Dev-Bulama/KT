import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { can, canAny } from "@/modules/rbac/authorize";
import { listRequests } from "@/modules/requests/service";
import { listCatalog } from "@/modules/admin/catalog";
import { prisma } from "@/lib/db";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { Pagination, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, humanize } from "@/lib/utils";

export const metadata = { title: "Service requests" };
const STATUSES = ["DRAFT", "SUBMITTED", "INITIAL_TRIAGE", "UNDER_ASSESSMENT", "NEEDS_INFORMATION", "TECHNICAL_EVALUATION", "SCOPE_ESTIMATION", "APPROVAL_REVIEW", "RETURNED_FOR_REVISION", "APPROVED", "PROJECT_INITIATED", "REJECTED", "DEFERRED", "WITHDRAWN"];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActor();
  const katdict = actor.userType !== "MDA_USER";
  const [data, catalog, mdas, depts] = await Promise.all([
    listRequests(actor, {
      q: sp.q, status: sp.status, mdaId: sp.mdaId, categoryId: sp.categoryId, departmentId: sp.departmentId, priority: sp.priority,
      from: sp.from ? new Date(sp.from) : undefined, to: sp.to ? new Date(`${sp.to}T23:59:59Z`) : undefined,
      page: Number(sp.page ?? 1), sort: (sp.sort as "newest") ?? "newest",
    }),
    listCatalog(),
    katdict && canAny(actor, ["mda.read.all", "request.read.all"]) ? prisma.mda.findMany({ where: { status: { in: ["ACTIVE", "SUSPENDED"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    katdict ? prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  return (
    <>
      <PageHeader
        title="Service requests"
        description={katdict ? "All requests within your access. Use filters to build work queues." : "Requests submitted by your MDA."}
        actions={<>
          {can(actor, "report.export") && <Button variant="secondary" asChild><a href={`/api/exports/requests?${exportQs}`}>Export CSV</a></Button>}
          {can(actor, "request.create") && <Button asChild><Link href="/requests/new">New request</Link></Button>}
        </>}
      />
      <form method="get" className="mb-4 grid gap-2 rounded-[var(--radius-card)] border border-line bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input name="q" placeholder="Reference or title" defaultValue={sp.q} aria-label="Search" />
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <Select name="categoryId" defaultValue={sp.categoryId ?? ""} aria-label="Service category"><option value="">All categories</option>{catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="priority" defaultValue={sp.priority ?? ""} aria-label="Priority"><option value="">Any priority</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select>
        {mdas.length > 0 && <Select name="mdaId" defaultValue={sp.mdaId ?? ""} aria-label="MDA"><option value="">All MDAs</option>{mdas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}
        {depts.length > 0 && <Select name="departmentId" defaultValue={sp.departmentId ?? ""} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
        <Input type="date" name="from" defaultValue={sp.from} aria-label="Submitted from" />
        <Input type="date" name="to" defaultValue={sp.to} aria-label="Submitted to" />
        <Select name="sort" defaultValue={sp.sort ?? "newest"} aria-label="Sort"><option value="newest">Recently updated</option><option value="oldest">Oldest first</option><option value="priority">Priority</option></Select>
        <div className="flex gap-2"><Button type="submit" variant="secondary">Filter</Button><Button variant="ghost" asChild><Link href="/requests">Reset</Link></Button></div>
      </form>
      {data.items.length === 0 ? (
        <EmptyState title="No requests found" description="Adjust the filters, or create a new request." />
      ) : (
        <Table caption="Service requests">
          <THead><tr><TH>Reference</TH><TH>Title</TH>{katdict && <TH>MDA</TH>}<TH>Service</TH><TH>Priority</TH><TH>Status</TH><TH>Submitted</TH></tr></THead>
          <tbody>
            {data.items.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap font-medium"><Link href={`/requests/${r.id}`}>{r.reference ?? "Draft"}</Link></TD>
                <TD className="max-w-xs">{r.title}</TD>
                {katdict && <TD>{r.mda.abbreviation}</TD>}
                <TD className="text-muted">{r.service.category.name}</TD>
                <TD><StatusBadge status={r.priority ?? r.urgency} /></TD>
                <TD><StatusBadge status={r.status} /></TD>
                <TD className="whitespace-nowrap text-muted">{formatDate(r.submittedAt)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/requests" params={sp} />
    </>
  );
}
