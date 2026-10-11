import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { listUsers } from "@/modules/admin/users";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { Pagination } from "@/components/ui/table";
import { formatDateTime, humanize } from "@/lib/utils";
import { inviteAction } from "../../mdas/actions";
import { staffProfileAction, userRolesAction, userStatusAction } from "../actions";

export const metadata = { title: "Users" };

export default async function Users({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActor("user.read");
  const [data, roles, depts] = await Promise.all([
    listUsers(actor, { q: sp.q, userType: sp.userType, status: sp.status, page: Number(sp.page ?? 1) }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const manage = can(actor, "user.manage");
  const assign = can(actor, "role.assign");
  return (
    <>
      <PageHeader title="Users" description="KATDICT staff, MDA users and oversight officers. MDA users are normally managed by their MDA administrator." />
      {manage && assign && (
        <Card className="mb-6"><CardHeader title="Invite KATDICT or oversight staff" /><CardBody>
          <ActionForm action={inviteAction} submitLabel="Send invitation" resetOnSuccess>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Official email" name="email" required><Input type="email" /></Field>
              <Field label="Name" name="name"><Input /></Field>
              <Field label="Role" name="roleKeys" required><Select defaultValue="PROJECT_OFFICER">{roles.filter((r) => r.userType !== "MDA_USER" && (r.key !== "SUPER_ADMIN" || actor.roles.includes("SUPER_ADMIN"))).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></Field>
              <Field label="Department" name="departmentId"><Select defaultValue=""><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            </div>
          </ActionForm>
        </CardBody></Card>
      )}
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Name or email" className="w-64" aria-label="Search users" />
        <Select name="userType" defaultValue={sp.userType ?? ""} className="w-48" aria-label="User type"><option value="">All types</option>{["KATDICT_STAFF", "MDA_USER", "OVERSIGHT"].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="w-48" aria-label="Status"><option value="">All statuses</option>{["ACTIVE", "PENDING_VERIFICATION", "SUSPENDED", "DEACTIVATED"].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <div className="space-y-3">
        {data.items.map((u) => (
          <details key={u.id} className="rounded-[var(--radius-card)] border border-line bg-white">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span><strong>{u.name}</strong> <span className="text-muted">· {u.email}</span>{u.membership && <span className="text-muted"> · {u.membership.mda.abbreviation}</span>}{u.department && <span className="text-muted"> · {u.department.name}</span>}</span>
              <span className="flex flex-wrap items-center gap-2">{u.roles.map((r) => <Badge key={r.role.key}>{r.role.name}</Badge>)}{u.mfaEnabled && <Badge tone="success">MFA</Badge>}<StatusBadge status={u.status} /></span>
            </summary>
            <div className="grid gap-4 border-t border-line px-4 py-4 lg:grid-cols-3">
              <p className="text-xs text-muted lg:col-span-3">Last sign-in: {formatDateTime(u.lastLoginAt)}</p>
              {assign && u.id !== actor.id && (
                <ActionForm action={userRolesAction} submitLabel="Save roles"><input type="hidden" name="userId" value={u.id} />
                  <fieldset className="space-y-1 text-sm"><legend className="mb-1 font-medium">Roles ({humanize(u.userType)})</legend>
                    {roles.filter((r) => r.userType === u.userType).map((r) => <label key={r.key} className="flex items-center gap-2"><input type="checkbox" name="roleKeys" value={r.key} defaultChecked={u.roles.some((x) => x.role.key === r.key)} disabled={r.key === "SUPER_ADMIN" && !actor.roles.includes("SUPER_ADMIN")} />{r.name}</label>)}
                  </fieldset>
                </ActionForm>
              )}
              {manage && u.id !== actor.id && (
                <ActionForm action={userStatusAction} submitLabel="Update status"><input type="hidden" name="userId" value={u.id} />
                  <Field label="Status" name="status"><Select defaultValue={u.status}>{["ACTIVE", "SUSPENDED", "DEACTIVATED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
                  <Field label="Reason" name="reason" required><Input /></Field>
                </ActionForm>
              )}
              {manage && u.userType === "KATDICT_STAFF" && (
                <ActionForm action={staffProfileAction} submitLabel="Save staff profile"><input type="hidden" name="userId" value={u.id} />
                  <Field label="Department" name="departmentId"><Select defaultValue={u.department?.id ?? ""}><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
                  <Field label="Skills (comma-separated)" name="skills" hint="Used for transparent assignment recommendations."><Input defaultValue={u.skills.join(", ")} /></Field>
                  <Field label="Max concurrent projects" name="maxConcurrentProjects"><Input type="number" min={1} max={50} defaultValue={u.maxConcurrentProjects} /></Field>
                </ActionForm>
              )}
            </div>
          </details>
        ))}
      </div>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/admin/users" params={sp} />
    </>
  );
}
