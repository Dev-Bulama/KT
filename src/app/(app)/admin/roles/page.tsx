import { requirePageActor } from "@/modules/auth/current";
import { listRolesWithPermissions } from "@/modules/admin/users";
import { PERMISSIONS, permissionModule } from "@/modules/rbac/permissions";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/forms/action-form";
import { humanize } from "@/lib/utils";
import { rolePermissionsAction } from "../actions";

export const metadata = { title: "Roles & permissions" };

export default async function Roles() {
  const actor = await requirePageActor("role.manage");
  const roles = await listRolesWithPermissions();
  const modules = [...new Set(Object.keys(PERMISSIONS).map(permissionModule))];
  return (
    <>
      <PageHeader title="Roles & permissions" description="Permissions are enforced on the server for every operation. Guardrails: MDA roles cannot receive KATDICT permissions, oversight roles stay read-only, and you cannot edit a role you hold." />
      <Alert tone="info" className="mb-4">Changes take effect at each user&apos;s next request. All changes are audited.</Alert>
      <div className="space-y-4">
        {roles.map((r) => {
          const held = new Set(r.permissions.map((p) => p.permission.key));
          const own = actor.roles.includes(r.key);
          return (
            <details key={r.id} className="rounded-[var(--radius-card)] border border-line bg-white">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3"><span className="font-semibold">{r.name} <span className="text-xs font-normal text-muted">({r.key})</span></span><span className="flex gap-2"><Badge>{humanize(r.userType)}</Badge><Badge tone="info">{held.size} permissions</Badge><Badge>{r._count.users} users</Badge></span></summary>
              <Card className="rounded-none border-0 border-t"><CardHeader title="Permissions" description={r.description ?? undefined} /><CardBody>
                {own && <Alert tone="warning" className="mb-3">You hold this role, so you cannot change it.</Alert>}
                <ActionForm action={rolePermissionsAction} submitLabel="Save permissions" hideSubmit={own}>
                  <input type="hidden" name="roleId" value={r.id} />
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {modules.map((m) => (
                      <fieldset key={m} className="text-sm"><legend className="mb-1 font-semibold capitalize">{m}</legend>
                        {Object.entries(PERMISSIONS).filter(([k]) => permissionModule(k) === m).map(([k, desc]) => (
                          <label key={k} className="flex items-start gap-2 py-0.5"><input type="checkbox" name="permissions" value={k} defaultChecked={held.has(k)} disabled={own} className="mt-1" /><span>{desc} <code className="text-[10px] text-muted">{k}</code></span></label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                </ActionForm>
              </CardBody></Card>
            </details>
          );
        })}
      </div>
    </>
  );
}
