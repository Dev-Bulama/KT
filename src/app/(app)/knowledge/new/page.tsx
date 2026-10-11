import { requirePageActor } from "@/modules/auth/current";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { KnowledgeForm } from "@/components/forms/knowledge-form";

export const metadata = { title: "New knowledge document" };

export default async function NewKnowledge() {
  await requirePageActor("knowledge.manage");
  const mdas = await prisma.mda.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (<><PageHeader breadcrumbs={[{ label: "Knowledge", href: "/knowledge" }, { label: "New" }]} title="New knowledge document" description="Documents are drafts until another knowledge manager approves and publishes them." /><Card><CardBody><KnowledgeForm mdas={mdas} /></CardBody></Card></>);
}
