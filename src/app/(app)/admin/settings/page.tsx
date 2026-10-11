import { requirePageActorAny } from "@/modules/auth/current";
import { canAny } from "@/modules/rbac/authorize";
import { getAllSettings } from "@/modules/settings/service";
import { getAIProvider } from "@/modules/ai/provider";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDateTime } from "@/lib/utils";
import { settingAction } from "../actions";

export const metadata = { title: "System settings" };

export default async function Settings() {
  await requirePageActorAny(["system.settings.manage", "system.ai.configure", "escalation.configure"]);
  const settings = await getAllSettings();
  const provider = getAIProvider();
  const groups = [...new Set(settings.map((s) => s.key.split(".")[0]))];
  return (
    <>
      <PageHeader title="System settings" description="Validated configuration stored in the database. Secrets (API keys, database credentials) are environment variables and are never shown here." />
      <Alert tone="info" className="mb-4">AI provider: <strong>{provider ? `${provider.name} (${provider.model})` : "not configured (AI_PROVIDER=disabled)"}</strong>. External processing also requires the data-governance approval setting below.</Alert>
      {groups.map((g) => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g}</h2>
          <div className="space-y-2">
            {settings.filter((s) => s.key.startsWith(`${g}.`)).map((s) => {
              const kind = typeof s.value === "boolean" ? "boolean" : typeof s.value === "number" ? "number" : typeof s.value === "string" ? "string" : "json";
              return (
                <Card key={s.key}><CardBody className="grid gap-3 md:grid-cols-[1fr_360px]">
                  <div><p className="font-mono text-sm">{s.key} {s.isDefault ? <Badge>default</Badge> : <Badge tone="info">customised {formatDateTime(s.updatedAt)}</Badge>}</p><p className="mt-1 text-sm text-muted">{s.description}</p></div>
                  <ActionForm action={settingAction} submitLabel="Save" inline>
                    <input type="hidden" name="key" value={s.key} /><input type="hidden" name="kind" value={kind} />
                    {kind === "boolean" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="value" defaultChecked={s.value as boolean} /> Enabled</label>
                      : kind === "number" ? <Input name="value" type="number" defaultValue={String(s.value)} className="w-32" aria-label={s.key} />
                      : kind === "string" ? <Input name="value" defaultValue={String(s.value)} className="w-56" aria-label={s.key} />
                      : <Textarea name="value" defaultValue={JSON.stringify(s.value)} rows={2} className="w-64 font-mono text-xs" aria-label={s.key} />}
                  </ActionForm>
                </CardBody></Card>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
