import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { getKnowledgeDoc } from "@/modules/knowledge/service";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/forms/action-form";
import { KnowledgeForm } from "@/components/forms/knowledge-form";
import { AttachmentList } from "@/components/shared/attachment-list";
import { FileUploader } from "@/components/forms/file-uploader";
import { formatDateTime, humanize } from "@/lib/utils";
import { knowledgeStatusAction } from "../actions";

export const metadata = { title: "Knowledge" };

export default async function KnowledgeDoc({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const { edit } = await searchParams;
  const actor = await requirePageActor("knowledge.read");
  let d: Awaited<ReturnType<typeof getKnowledgeDoc>>;
  try { d = await getKnowledgeDoc(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const manage = can(actor, "knowledge.manage");
  const mdas = manage && edit ? await prisma.mda.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Knowledge", href: "/knowledge" }, { label: d.title }]} title={d.title} description={<span className="flex flex-wrap items-center gap-2"><Badge>{humanize(d.category)}</Badge><StatusBadge status={d.status} /> {humanize(d.visibility)} · by {d.author.name}{d.approvedBy ? ` · approved by ${d.approvedBy.name}` : ""} · {formatDateTime(d.updatedAt)}</span>}
        actions={manage ? <Link href={edit ? `/knowledge/${d.id}` : `/knowledge/${d.id}?edit=1`}>{edit ? "Cancel editing" : "Edit"}</Link> : undefined} />
      {edit && manage ? <Card><CardBody><KnowledgeForm doc={d} mdas={mdas} /></CardBody></Card> : (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <Card><CardBody className="space-y-3"><p className="font-medium">{d.summary}</p><div className="whitespace-pre-line text-sm leading-relaxed">{d.body}</div>{d.project && <p className="text-sm">Source project: <Link href={`/projects/${d.project.id}`}>{d.project.reference}</Link></p>}<p className="text-xs text-muted">{d.tags.map((t) => `#${t}`).join(" ")}</p></CardBody></Card>
          <div className="space-y-4">
            <Card><CardHeader title="Attachments" /><CardBody className="space-y-3"><AttachmentList items={d.attachments} />{manage && <FileUploader target={{ knowledgeDocumentId: d.id }} categories={false} />}</CardBody></Card>
            {manage && (
              <Card><CardHeader title="Approval" description="Authors cannot publish their own documents." /><CardBody className="flex flex-wrap gap-2">
                {d.status !== "PUBLISHED" && d.authorId !== actor.id && <ActionForm inline action={knowledgeStatusAction} submitLabel="Approve & publish" submitVariant="accent"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="status" value="PUBLISHED" /></ActionForm>}
                {d.status !== "ARCHIVED" && <ActionForm inline action={knowledgeStatusAction} submitLabel="Archive" submitVariant="secondary"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="status" value="ARCHIVED" /></ActionForm>}
              </CardBody></Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
