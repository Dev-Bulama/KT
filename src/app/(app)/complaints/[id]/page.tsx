import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { getComplaint } from "@/modules/feedback/service";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { PageHeader, DescriptionList } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDateTime, humanize } from "@/lib/utils";
import { complaintUpdateAction } from "../../feedback/actions";

export const metadata = { title: "Complaint" };

export default async function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePageActor();
  let c: Awaited<ReturnType<typeof getComplaint>>;
  try { c = await getComplaint(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const history = can(actor, "audit.read") || can(actor, "complaint.manage") || c.raisedById === actor.id
    ? await prisma.auditEvent.findMany({ where: { entityType: "Complaint", entityId: id }, orderBy: { id: "asc" }, select: { id: true, action: true, reason: true, createdAt: true, actorEmail: true } })
    : [];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Feedback & complaints", href: "/feedback?tab=complaints" }, { label: c.reference }]} title={<span className="flex items-center gap-3">{c.subject}<StatusBadge status={c.status} /></span>} description={`${c.reference} · ${c.mda.name}`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card><CardBody><DescriptionList items={[["Description", c.description], ["Priority", humanize(c.priority)], ["Raised by", c.raisedBy.name], ["Raised", formatDateTime(c.createdAt)], ["Handled by", c.assignedTo?.name ?? "Unassigned"], ["Related project", c.project ? <Link key="p" href={`/projects/${c.project.id}`}>{c.project.reference}</Link> : "—"], ["Escalated", formatDateTime(c.escalatedAt)], ["Resolution", c.resolution]]} /></CardBody></Card>
          <Card><CardHeader title="History" /><CardBody><ul className="space-y-2 text-sm">{history.map((h) => <li key={String(h.id)}><span className="text-xs text-muted">{formatDateTime(h.createdAt)}</span> · {humanize(h.action.split(".").pop() ?? h.action)}{h.reason ? ` — ${h.reason}` : ""}</li>)}</ul></CardBody></Card>
        </div>
        {can(actor, "complaint.manage") && c.status !== "CLOSED" && (
          <Card><CardHeader title="Handle complaint" /><CardBody>
            <ActionForm action={complaintUpdateAction} submitLabel="Update">
              <input type="hidden" name="id" value={c.id} />
              <Field label="Action" name="action" required><Select defaultValue=""><option value="">— Choose —</option><option value="REVIEW">Take under review</option><option value="ESCALATE">Escalate to executive</option><option value="RESOLVE">Resolve</option><option value="CLOSE">Close (after resolution)</option></Select></Field>
              <Field label="Note to the MDA" name="note" required><Textarea rows={3} /></Field>
            </ActionForm>
          </CardBody></Card>
        )}
      </div>
    </>
  );
}
