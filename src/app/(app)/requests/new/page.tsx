import { requirePageActor } from "@/modules/auth/current";
import { listCatalog } from "@/modules/admin/catalog";
import { PageHeader, Alert } from "@/components/ui/misc";
import { RequestWizard } from "../request-wizard";

export const metadata = { title: "New service request" };

export default async function NewRequest() {
  const actor = await requirePageActor("request.create");
  const catalog = await listCatalog();
  const blocked = actor.mdaStatus !== "ACTIVE" ? "Your MDA account must be active to submit requests." : !actor.roles.includes("MDA_ADMIN") && !actor.staffMaySubmit ? "Your MDA's policy only allows MDA administrators to submit requests." : null;
  return (
    <>
      <PageHeader title="New service request" description="Complete each step. Your draft is saved as you go." breadcrumbs={[{ label: "Requests", href: "/requests" }, { label: "New" }]} />
      {blocked ? <Alert tone="warning">{blocked}</Alert> : <RequestWizard catalog={catalog.map((c) => ({ id: c.id, name: c.name, description: c.description, services: c.services.map((s) => ({ id: s.id, name: s.name, description: s.description, requiredInformation: s.requiredInformation, requiredAttachments: s.requiredAttachments, estimatedMinDays: s.estimatedMinDays, estimatedMaxDays: s.estimatedMaxDays, standardDeliverables: s.standardDeliverables })) }))} />}
    </>
  );
}
