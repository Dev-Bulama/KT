import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { searchAudit } from "@/modules/audit/query";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { Pagination, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { verifyChainAction } from "../actions";

export const metadata = { title: "Audit log" };

export default async function AuditLog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActor("audit.read");
  const data = await searchAudit(actor, { q: sp.q, action: sp.action, entityType: sp.entityType, entityId: sp.entityId, from: sp.from ? new Date(sp.from) : undefined, to: sp.to ? new Date(`${sp.to}T23:59:59Z`) : undefined, page: Number(sp.page ?? 1) });
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Audit log" description="Append-only, hash-chained record of significant actions. Records cannot be modified or deleted through the application or by ordinary database users."
        actions={<><Button variant="secondary" asChild><a href={`/api/exports/audit?${qs}`}>Export CSV</a></Button><ActionForm inline action={verifyChainAction} submitLabel="Verify integrity" submitVariant="secondary" /></>} />
      <form method="get" className="mb-4 grid gap-2 rounded-[var(--radius-card)] border border-line bg-white p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Input name="q" defaultValue={sp.q} placeholder="Actor email / action / id" aria-label="Search" />
        <Input name="action" defaultValue={sp.action} placeholder="Action prefix, e.g. request." aria-label="Action" />
        <Input name="entityType" defaultValue={sp.entityType} placeholder="Entity type" aria-label="Entity type" />
        <Input type="date" name="from" defaultValue={sp.from} aria-label="From" />
        <Input type="date" name="to" defaultValue={sp.to} aria-label="To" />
        <div className="flex gap-2"><Button type="submit" variant="secondary">Filter</Button><Button variant="ghost" asChild><Link href="/admin/audit">Reset</Link></Button></div>
      </form>
      <Table caption="Audit events">
        <THead><tr><TH>#</TH><TH>Time</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>Change</TH><TH>Reason</TH></tr></THead>
        <tbody>{data.items.map((e) => (
          <TR key={String(e.id)}>
            <TD className="text-xs text-muted">{String(e.id)}</TD>
            <TD className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</TD>
            <TD className="text-xs">{e.actorEmail ?? e.actorId ?? "System"}{e.ip && <><br /><span className="text-muted">{e.ip}</span></>}</TD>
            <TD className="font-mono text-xs">{e.action}</TD>
            <TD className="text-xs">{e.entityType}<br /><Link href={`/admin/audit?entityType=${e.entityType}&entityId=${e.entityId ?? ""}`} className="text-muted">{e.entityId}</Link></TD>
            <TD className="max-w-xs text-xs"><details><summary className="cursor-pointer text-muted">view</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ before: e.before, after: e.after }, null, 1)}</pre><p className="mt-1 break-all text-[10px] text-muted">hash {e.hash.slice(0, 16)}… prev {e.prevHash?.slice(0, 16) ?? "—"}</p></details></TD>
            <TD className="max-w-xs text-xs">{e.reason}</TD>
          </TR>
        ))}</tbody>
      </Table>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/admin/audit" params={sp} />
    </>
  );
}
