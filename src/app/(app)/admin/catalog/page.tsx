import { requirePageActor } from "@/modules/auth/current";
import { listCatalog, listPolicies } from "@/modules/admin/catalog";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { humanize } from "@/lib/utils";
import { categoryAction, policyAction, serviceAction } from "../actions";

export const metadata = { title: "Service catalogue" };
const PRI = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export default async function CatalogAdmin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requirePageActor("catalog.manage");
  const tab = sp.tab === "policies" ? "policies" : "catalog";
  const [catalog, policies, depts] = await Promise.all([listCatalog(true), listPolicies(), prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const lines = (a: string[]) => a.join("\n");

  const serviceForm = (categoryId: string, s?: (typeof catalog)[number]["services"][number]) => (
    <ActionForm action={serviceAction} submitLabel={s ? "Save service" : "Add service"} resetOnSuccess={!s}>
      <>
        {s && <input type="hidden" name="id" value={s.id} />}
        <input type="hidden" name="categoryId" value={categoryId} />
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Code" name="code" required><Input defaultValue={s?.code} /></Field>
          <Field label="Name" name="name" required className="md:col-span-2"><Input defaultValue={s?.name} /></Field>
          <Field label="Description" name="description" required className="md:col-span-3"><Textarea rows={2} defaultValue={s?.description} /></Field>
          <Field label="Eligibility" name="eligibility"><Input defaultValue={s?.eligibility ?? ""} /></Field>
          <Field label="Default priority" name="defaultPriority"><Select defaultValue={s?.defaultPriority ?? "MEDIUM"}>{PRI.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
          <Field label="Suggested department" name="suggestedDepartmentId"><Select defaultValue={s?.suggestedDepartmentId ?? ""}><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Approval policy" name="approvalPolicyId"><Select defaultValue={s?.approvalPolicyId ?? ""}><option value="">Default policy</option>{policies.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Delivery estimate min (days)" name="estimatedMinDays"><Input type="number" defaultValue={s?.estimatedMinDays ?? ""} /></Field>
          <Field label="Delivery estimate max (days)" name="estimatedMaxDays"><Input type="number" defaultValue={s?.estimatedMaxDays ?? ""} /></Field>
          <Field label="SLA triage (hours)" name="slaTriageHours" hint="Blank = category default"><Input type="number" defaultValue={s?.slaTriageHours ?? ""} /></Field>
          <Field label="SLA assessment (working days)" name="slaAssessmentDays"><Input type="number" defaultValue={s?.slaAssessmentDays ?? ""} /></Field>
          <Field label="SLA delivery (days)" name="slaDeliveryDays"><Input type="number" defaultValue={s?.slaDeliveryDays ?? ""} /></Field>
          <Field label="Required information (one per line)" name="requiredInformation"><Textarea rows={3} defaultValue={lines(s?.requiredInformation ?? [])} /></Field>
          <Field label="Required attachments (one per line)" name="requiredAttachments"><Textarea rows={3} defaultValue={lines(s?.requiredAttachments ?? [])} /></Field>
          <Field label="Standard deliverables (one per line)" name="standardDeliverables"><Textarea rows={3} defaultValue={lines(s?.standardDeliverables ?? [])} /></Field>
          <Field label="Assessment checklist (one per line)" name="assessmentChecklist" className="md:col-span-1"><Textarea rows={3} defaultValue={lines(s?.assessmentChecklist ?? [])} /></Field>
          <Field label="Priority rules (JSON)" name="priorityRules" className="md:col-span-2" hint='e.g. [{"when":{"urgency":"CRITICAL"},"priority":"CRITICAL"},{"when":{"estimatedUsersGte":1000},"priority":"HIGH"}]'><Textarea rows={3} defaultValue={s?.priorityRules ? JSON.stringify(s.priorityRules) : ""} className="font-mono text-xs" /></Field>
        </div>
        <Checkbox name="active" label="Active (available to MDAs)" defaultChecked={s?.active ?? true} />
      </>
    </ActionForm>
  );

  return (
    <>
      <PageHeader title="Service catalogue administration" description="Categories, services, service-level targets and approval policies. Changes are audited; deactivated services remain on historical requests." />
      <Tabs basePath="/admin/catalog" active={tab} tabs={[{ key: "catalog", label: "Categories & services" }, { key: "policies", label: "Approval policies" }]} />
      {tab === "catalog" && (
        <div className="space-y-4">
          <Card><CardHeader title="New category" /><CardBody>
            <ActionForm action={categoryAction} submitLabel="Create category" resetOnSuccess>
              <div className="grid gap-3 md:grid-cols-6">
                <Field label="Code" name="code" required><Input /></Field><Field label="Name" name="name" required className="md:col-span-2"><Input /></Field>
                <Field label="Triage SLA (h)" name="slaTriageHours"><Input type="number" defaultValue={48} /></Field><Field label="Assessment SLA (wd)" name="slaAssessmentDays"><Input type="number" defaultValue={10} /></Field><Field label="Delivery SLA (d)" name="slaDeliveryDays"><Input type="number" defaultValue={90} /></Field>
              </div>
              <Checkbox name="active" label="Active" defaultChecked />
            </ActionForm>
          </CardBody></Card>
          {catalog.map((c) => (
            <details key={c.id} className="rounded-[var(--radius-card)] border border-line bg-white">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3"><span className="font-semibold">{c.name}</span><span className="flex gap-2">{!c.active && <Badge tone="warning">Inactive</Badge>}<Badge>{c.services.length} services</Badge><Badge tone="info">SLA {c.slaAssessmentDays}wd / {c.slaDeliveryDays}d</Badge></span></summary>
              <div className="space-y-4 border-t border-line p-4">
                <ActionForm action={categoryAction} submitLabel="Save category">
                  <input type="hidden" name="id" value={c.id} />
                  <div className="grid gap-3 md:grid-cols-6">
                    <Field label="Code" name="code" required><Input defaultValue={c.code} /></Field><Field label="Name" name="name" required className="md:col-span-2"><Input defaultValue={c.name} /></Field>
                    <Field label="Triage SLA (h)" name="slaTriageHours"><Input type="number" defaultValue={c.slaTriageHours} /></Field><Field label="Assessment SLA (wd)" name="slaAssessmentDays"><Input type="number" defaultValue={c.slaAssessmentDays} /></Field><Field label="Delivery SLA (d)" name="slaDeliveryDays"><Input type="number" defaultValue={c.slaDeliveryDays} /></Field>
                    <Field label="Description" name="description" className="md:col-span-5"><Input defaultValue={c.description ?? ""} /></Field><Field label="Order" name="sortOrder"><Input type="number" defaultValue={c.sortOrder} /></Field>
                  </div>
                  <Checkbox name="active" label="Active" defaultChecked={c.active} />
                </ActionForm>
                {c.services.map((s) => <details key={s.id} className="rounded-md border border-line"><summary className="cursor-pointer px-3 py-2 text-sm font-medium">{s.name} {!s.active && <Badge tone="warning">Inactive</Badge>}</summary><div className="border-t border-line p-3">{serviceForm(c.id, s)}</div></details>)}
                <details className="rounded-md border border-dashed border-line"><summary className="cursor-pointer px-3 py-2 text-sm">+ Add a service to {c.name}</summary><div className="border-t border-line p-3">{serviceForm(c.id)}</div></details>
              </div>
            </details>
          ))}
        </div>
      )}
      {tab === "policies" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">A step applies when it has no thresholds, or when <strong>any</strong> configured threshold is met. Applicable steps are approved in order by different people. Steps cannot be changed while requests using the policy are in approval review.</p>
          {[...policies.filter((p) => p.active), null].map((p, idx) => (
            <Card key={p?.id ?? "new"}><CardHeader title={p ? <span className="flex items-center gap-2">{p.name}{p.isDefault && <Badge tone="success">Default</Badge>}</span> : "New approval policy"} description={p ? `${p._count.services} services use this policy` : undefined} /><CardBody>
              <ActionForm action={policyAction} submitLabel={p ? "Save policy" : "Create policy"} resetOnSuccess={!p}>
                {p && <input type="hidden" name="id" value={p.id} />}
                <div className="grid gap-3 md:grid-cols-3"><Field label="Name" name="name" required><Input defaultValue={p?.name} /></Field><Field label="Description" name="description" className="md:col-span-2"><Input defaultValue={p?.description ?? ""} /></Field></div>
                <Checkbox name="isDefault" label="Default policy (used by services without a specific policy)" defaultChecked={p?.isDefault ?? false} />
                <table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr><th className="py-1">#</th><th>Step name</th><th>Authority</th><th>Min priority</th><th>Min cost (NGN)</th><th>Min effort (days)</th></tr></thead>
                  <tbody>{[0, 1, 2, 3, 4].map((i) => { const s = p?.steps[i]; return (
                    <tr key={i} className="border-t border-line"><td className="py-1 pr-2">{i + 1}</td>
                      <td><Input name={`step${i}.name`} defaultValue={s?.name ?? ""} aria-label={`Step ${i + 1} name`} className="h-8" /></td>
                      <td><Select name={`step${i}.permission`} defaultValue={s?.requiredPermission ?? "request.approve.technical"} aria-label={`Step ${i + 1} authority`} className="h-8"><option value="request.approve.technical">Technical</option><option value="request.approve.department">Departmental</option><option value="request.approve.executive">Executive</option></Select></td>
                      <td><Select name={`step${i}.minPriority`} defaultValue={s?.minPriority ?? ""} aria-label={`Step ${i + 1} minimum priority`} className="h-8"><option value="">—</option>{PRI.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select></td>
                      <td><Input name={`step${i}.minCost`} type="number" defaultValue={s?.minEstimatedCostNgn?.toString() ?? ""} aria-label={`Step ${i + 1} minimum cost`} className="h-8" /></td>
                      <td><Input name={`step${i}.minEffort`} type="number" defaultValue={s?.minEstimatedEffortDays ?? ""} aria-label={`Step ${i + 1} minimum effort`} className="h-8" /></td></tr>
                  ); })}</tbody></table>
                <p className="text-xs text-muted">Leave a step name blank to remove it. {idx === 0 && "Default thresholds are placeholders pending KATDICT management confirmation."}</p>
              </ActionForm>
            </CardBody></Card>
          ))}
        </div>
      )}
    </>
  );
}
