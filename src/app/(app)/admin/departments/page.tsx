import { requirePageActor } from "@/modules/auth/current";
import { listDepartments } from "@/modules/admin/users";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { departmentAction } from "../actions";

export const metadata = { title: "Departments" };

export default async function Departments() {
  await requirePageActor("department.manage");
  const [depts, heads] = await Promise.all([listDepartments(), prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { key: "DEPARTMENT_HEAD" } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const form = (d?: (typeof depts)[number]) => (
    <ActionForm action={departmentAction} submitLabel={d ? "Save" : "Create department"} resetOnSuccess={!d}>
      {d && <input type="hidden" name="id" value={d.id} />}
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="Code" name="code" required><Input defaultValue={d?.code} /></Field>
        <Field label="Name" name="name" required className="md:col-span-2"><Input defaultValue={d?.name} /></Field>
        <Field label="Head" name="headId"><Select defaultValue={d?.head?.id ?? ""}><option value="">—</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Select></Field>
        <div className="flex items-end pb-2"><Checkbox name="active" label="Active" defaultChecked={d?.active ?? true} /></div>
        <Field label="Description" name="description" className="md:col-span-5"><Input defaultValue={d?.description ?? ""} /></Field>
      </div>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Departments" description="KATDICT departments used for routing, assignment and workload. The defaults are editable and are not an approved organisational structure." />
      <Card className="mb-6"><CardHeader title="New department" /><CardBody>{form()}</CardBody></Card>
      <div className="space-y-3">{depts.map((d) => <Card key={d.id}><CardHeader title={d.name} description={`${d._count.members} members · ${d._count.projects} projects`} /><CardBody>{form(d)}</CardBody></Card>)}</div>
    </>
  );
}
