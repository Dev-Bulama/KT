import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { getMda } from "@/modules/mdas/service";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { requestScope, projectScope } from "@/modules/rbac/scope";
import { PageHeader, DescriptionList, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { MdaProfileFields } from "@/components/forms/mda-profile-fields";
import { formatDateTime, humanize } from "@/lib/utils";
import { reviewMdaAction, suspendMdaAction, updateProfileAction } from "../actions";

export const metadata = { title: "MDA" };

export default async function MdaDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePageActor();
  let m: Awaited<ReturnType<typeof getMda>>;
  try {
    m = await getMda(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [requests, projects, ministries] = await Promise.all([
    prisma.serviceRequest.findMany({ where: { AND: [requestScope(actor), { mdaId: id, status: { not: "DRAFT" } }] }, select: { id: true, reference: true, title: true, status: true }, orderBy: { submittedAt: "desc" }, take: 10 }),
    prisma.project.findMany({ where: { AND: [projectScope(actor), { mdaId: id }] }, select: { id: true, reference: true, title: true, status: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.mda.findMany({ where: { category: "MINISTRY", status: { not: "REJECTED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "MDA directory", href: "/mdas" }, { label: m.abbreviation }]} title={<span className="flex flex-wrap items-center gap-3">{m.name}<StatusBadge status={m.status} /></span>} description={`${m.abbreviation} · ${humanize(m.category)}${m.supervisingMinistry ? ` · supervised by ${m.supervisingMinistry.name}` : ""}`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card><CardHeader title="Institutional profile" /><CardBody>
            <DescriptionList items={[["Address", m.address], ["Official email", m.officialEmail], ["Official telephone", m.officialPhone], ["Contact person", m.contactPersonName ? `${m.contactPersonName} (${m.contactPersonDesignation ?? ""})` : null], ["ICT contact", [m.ictContactName, m.ictContactEmail, m.ictContactPhone].filter(Boolean).join(" · ") || null], ["Website", m.website], ["Details", m.description]]} />
          </CardBody></Card>
          <Card><CardHeader title="Registration record" /><CardBody>
            <DescriptionList items={[["Registered by", m.registeredBy ? `${m.registeredBy.name} (${m.registeredBy.email})` : "Directory import"], ["Submitted", formatDateTime(m.submittedAt)], ["Reviewed by", m.reviewedBy?.name ?? "—"], ["Reviewed", formatDateTime(m.reviewedAt)], ["Review notes", m.reviewNotes], ["Approved", formatDateTime(m.approvedAt)], ["Activated", formatDateTime(m.activatedAt)], ...(m.suspendedAt ? [["Suspended", `${formatDateTime(m.suspendedAt)} — ${m.suspensionReason}`] as [string, string]] : [])]} />
          </CardBody></Card>
          {m.members.length > 0 && (
            <Card><CardHeader title="Authorised users" /><CardBody><ul className="divide-y divide-line text-sm">{m.members.map((x) => <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{x.user.name} <span className="text-muted">· {x.user.email}{x.isPrimaryRepresentative ? " · primary representative" : ""}</span></span><span className="flex gap-2">{x.user.roles.map((r) => <span key={r.roleId} className="text-xs text-muted">{r.role.name}</span>)}<StatusBadge status={x.user.status} /></span></li>)}</ul></CardBody></Card>
          )}
          <div className="grid gap-6 md:grid-cols-2">
            <Card><CardHeader title="Recent requests" /><CardBody>{requests.length ? <ul className="space-y-1 text-sm">{requests.map((r) => <li key={r.id} className="flex justify-between gap-2"><Link href={`/requests/${r.id}`}>{r.reference}</Link><StatusBadge status={r.status} /></li>)}</ul> : <p className="text-sm text-muted">None.</p>}</CardBody></Card>
            <Card><CardHeader title="Projects" /><CardBody>{projects.length ? <ul className="space-y-1 text-sm">{projects.map((p) => <li key={p.id} className="flex justify-between gap-2"><Link href={`/projects/${p.id}`}>{p.reference}</Link><StatusBadge status={p.status} /></li>)}</ul> : <p className="text-sm text-muted">None.</p>}</CardBody></Card>
          </div>
        </div>
        <aside className="space-y-4">
          {can(actor, "mda.review") && m.status === "PENDING_REVIEW" && m.submittedAt && (
            <Card className="border-amber-300"><CardHeader title="Review registration" description="Verify the representative's authority with the MDA through official channels before approving." /><CardBody>
              <ActionForm action={reviewMdaAction} submitLabel="Record decision">
                <input type="hidden" name="id" value={m.id} /><input type="hidden" name="version" value={m.version} />
                <Field label="Decision" name="decision" required><Select defaultValue=""><option value="">— Choose —</option><option value="APPROVE">Approve</option><option value="REQUEST_CHANGES">Request corrections</option><option value="REJECT">Reject</option></Select></Field>
                <Field label="Notes / reasons" name="notes" hint="Required for corrections or rejection; sent to the MDA."><Textarea rows={3} /></Field>
              </ActionForm>
            </CardBody></Card>
          )}
          {can(actor, "mda.review") && m.status === "PENDING_REVIEW" && !m.submittedAt && <Alert tone="info">Awaiting the representative&apos;s email verification before review.</Alert>}
          {can(actor, "mda.manage") && ["ACTIVE", "SUSPENDED"].includes(m.status) && (
            <Card><CardHeader title={m.status === "ACTIVE" ? "Suspend MDA" : "Reactivate MDA"} /><CardBody>
              <ActionForm action={suspendMdaAction} submitLabel={m.status === "ACTIVE" ? "Suspend" : "Reactivate"} submitVariant={m.status === "ACTIVE" ? "danger" : "accent"} confirm="Change this MDA's account status?">
                <input type="hidden" name="id" value={m.id} /><input type="hidden" name="mode" value={m.status === "ACTIVE" ? "suspend" : "reactivate"} />
                <Field label="Reason" name="reason" required><Textarea rows={2} /></Field>
              </ActionForm>
            </CardBody></Card>
          )}
          {can(actor, "mda.manage") && (
            <Card><CardHeader title="Correct profile (KATDICT)" /><CardBody>
              <ActionForm action={updateProfileAction} submitLabel="Save profile">
                <><input type="hidden" name="id" value={m.id} /><input type="hidden" name="version" value={m.version} /><MdaProfileFields m={m} ministries={ministries} /></>
              </ActionForm>
            </CardBody></Card>
          )}
        </aside>
      </div>
    </>
  );
}
