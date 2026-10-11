import { notFound } from "next/navigation";
import { requirePageActor } from "@/modules/auth/current";
import { listCatalog } from "@/modules/admin/catalog";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { RequestWizard } from "../../request-wizard";

export const metadata = { title: "Edit draft" };

export default async function EditDraft({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePageActor("request.create");
  const r = await prisma.serviceRequest.findFirst({ where: { id, createdById: actor.id, status: "DRAFT" }, include: { attachments: { select: { id: true, originalName: true, sizeBytes: true } } } });
  if (!r) notFound();
  const catalog = await listCatalog();
  const s = (v: string | null) => v ?? "";
  return (
    <>
      <PageHeader title="Edit draft request" breadcrumbs={[{ label: "Requests", href: "/requests" }, { label: r.title }]} />
      <RequestWizard
        catalog={catalog.map((c) => ({ id: c.id, name: c.name, description: c.description, services: c.services.map((x) => ({ id: x.id, name: x.name, description: x.description, requiredInformation: x.requiredInformation, requiredAttachments: x.requiredAttachments, estimatedMinDays: x.estimatedMinDays, estimatedMaxDays: x.estimatedMaxDays, standardDeliverables: x.standardDeliverables })) }))}
        initial={{
          id: r.id, version: r.version, attachments: r.attachments,
          values: {
            serviceId: r.serviceId, title: r.title, problemStatement: s(r.problemStatement), currentSituation: s(r.currentSituation), desiredOutcome: s(r.desiredOutcome),
            businessJustification: s(r.businessJustification), expectedBeneficiaries: s(r.expectedBeneficiaries), estimatedUsers: r.estimatedUsers?.toString() ?? "",
            urgency: r.urgency, preferredCompletionDate: r.preferredCompletionDate?.toISOString().slice(0, 10) ?? "", existingSystems: s(r.existingSystems),
            technicalInformation: s(r.technicalInformation), knownDependencies: s(r.knownDependencies), expectedDeliverables: s(r.expectedDeliverables),
            successCriteria: s(r.successCriteria), institutionalImpact: s(r.institutionalImpact), operationalUrgency: s(r.operationalUrgency),
            legalConsiderations: s(r.legalConsiderations), consequencesOfInaction: s(r.consequencesOfInaction),
          },
        }}
      />
    </>
  );
}
