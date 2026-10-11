import Link from "next/link";
import { requirePageActorAny } from "@/modules/auth/current";
import { can, canAny } from "@/modules/rbac/authorize";
import { listMdas } from "@/modules/mdas/service";
import { prisma } from "@/lib/db";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Pagination, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, humanize } from "@/lib/utils";

export const metadata = { title: "MDA directory" };

export default async function MdasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActorAny(["mda.read.all", "mda.review"]);
  const [data, pending] = await Promise.all([
    listMdas(actor, { q: sp.q, status: sp.status, category: sp.category, page: Number(sp.page ?? 1) }),
    prisma.mda.count({ where: { status: "PENDING_REVIEW", submittedAt: { not: null } } }),
  ]);
  return (
    <>
      <PageHeader title="MDA directory" description="Institutional records for Katsina State MDAs. Official names come only from the verified directory import or KATDICT-approved registrations."
        actions={can(actor, "mda.import") ? <Button variant="secondary" asChild><Link href="/mdas/import">Import verified directory</Link></Button> : undefined} />
      {can(actor, "mda.review") && <div className="mb-4 max-w-xs"><StatCard label="Registrations awaiting review" value={pending} href="/mdas?status=PENDING_REVIEW" tone={pending ? "warning" : undefined} /></div>}
      <form method="get" className="mb-4 flex flex-wrap gap-2 rounded-[var(--radius-card)] border border-line bg-white p-3">
        <Input name="q" placeholder="Name or abbreviation" defaultValue={sp.q} className="w-64" aria-label="Search" />
        <Select name="status" defaultValue={sp.status ?? ""} className="w-52" aria-label="Status"><option value="">All statuses</option>{["DIRECTORY", "PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED", "ACTIVE", "SUSPENDED", "REJECTED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <Select name="category" defaultValue={sp.category ?? ""} className="w-48" aria-label="Category"><option value="">All categories</option>{["MINISTRY", "DEPARTMENT", "AGENCY", "COMMISSION", "BOARD", "PARASTATAL", "INSTITUTION", "OTHER"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {data.items.length === 0 ? <EmptyState title="No MDAs found" description="Import the verified official directory to populate the list." /> : (
        <Table caption="MDAs">
          <THead><tr><TH>Name</TH><TH>Abbreviation</TH><TH>Category</TH><TH>Status</TH><TH className="text-right">Requests</TH><TH className="text-right">Projects</TH><TH className="text-right">Users</TH><TH>Submitted</TH></tr></THead>
          <tbody>{data.items.map((m) => (
            <TR key={m.id}><TD><Link href={`/mdas/${m.id}`}>{m.name}</Link> {m.isDirectoryVerified && <Badge tone="success" className="ml-1">Verified directory</Badge>}</TD><TD>{m.abbreviation}</TD><TD>{humanize(m.category)}</TD><TD><StatusBadge status={m.status} /></TD>
              <TD className="text-right tabular-nums">{m._count.requests}</TD><TD className="text-right tabular-nums">{m._count.projects}</TD><TD className="text-right tabular-nums">{m._count.members}</TD><TD className="text-muted">{formatDate(m.submittedAt)}</TD></TR>
          ))}</tbody>
        </Table>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/mdas" params={sp} />
    </>
  );
}
