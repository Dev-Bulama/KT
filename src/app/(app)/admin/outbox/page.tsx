import { requirePageActor } from "@/modules/auth/current";
import { prisma } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { ActionForm } from "@/components/forms/action-form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { processOutboxAction, retryOutboxAction } from "../actions";

export const metadata = { title: "Notification queue" };

export default async function Outbox() {
  await requirePageActor("system.notifications.manage");
  const [counts, items] = await Promise.all([
    prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outboxEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;
  return (
    <>
      <PageHeader title="Notification delivery queue" description={`Emails are queued in a transactional outbox and delivered by a scheduled job with retries and exponential backoff. Provider: ${process.env.EMAIL_PROVIDER ?? "console"}.`} actions={<ActionForm inline action={processOutboxAction} submitLabel="Run delivery now" submitVariant="secondary" />} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">{["PENDING", "PROCESSING", "SENT", "FAILED", "DEAD"].map((s) => <StatCard key={s} label={s} value={c(s)} tone={s === "DEAD" && c(s) ? "danger" : s === "FAILED" && c(s) ? "warning" : undefined} />)}</div>
      <Table caption="Outbox"><THead><tr><TH>Created</TH><TH>To</TH><TH>Subject</TH><TH>Status</TH><TH>Attempts</TH><TH>Last error</TH><TH /></tr></THead>
        <tbody>{items.map((e) => { const p = e.payload as { to?: string; subject?: string }; return (
          <TR key={e.id}><TD className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</TD><TD className="text-xs">{p.to}</TD><TD className="text-xs">{p.subject}</TD><TD><StatusBadge status={e.status} /></TD><TD>{e.attempts}/{e.maxAttempts}</TD><TD className="max-w-xs text-xs text-danger-700">{e.lastError}</TD>
            <TD>{["FAILED", "DEAD"].includes(e.status) && <ActionForm inline action={retryOutboxAction} submitLabel="Retry" submitVariant="ghost"><input type="hidden" name="id" value={e.id} /></ActionForm>}</TD></TR>
        ); })}</tbody></Table>
    </>
  );
}
