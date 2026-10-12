import { requirePageActor } from "@/modules/auth/current";
import { getChatbotConfigView } from "@/modules/site/chatbot";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDateTime } from "@/lib/utils";
import { PUBLIC_WIDGET_PATHS } from "@/lib/site-paths";
import { chatbotAction } from "../site-actions";

export const metadata = { title: "Chatbot widget" };

const EXAMPLE = `<script src="https://widget.example.com/embed.js" data-bot-id="YOUR-BOT-ID" defer></script>`;

export default async function Chatbot() {
  const actor = await requirePageActor("system.settings.manage");
  const c = await getChatbotConfigView(actor);
  return (
    <>
      <PageHeader title="Chatbot widget" description="Add a third-party chat or support widget (for example SkillyChat) to the website by pasting the embed code your provider gives you." />
      <Alert tone={c.enabled ? "success" : "info"} className="mb-4">
        Status: <strong>{c.enabled ? "enabled" : "disabled"}</strong>
        {c.provider ? <> · {c.provider}</> : null}
        {c.updatedAt ? <> · last changed {formatDateTime(c.updatedAt)}</> : null}
      </Alert>
      <Alert tone="warning" className="mb-4" title="Only use a provider KATDICT trusts">
        The widget&apos;s code runs inside the platform&apos;s pages and can read what is shown on them. It never runs on the sign-in, registration, account-security or administration pages. Enable it on signed-in pages only after the provider&apos;s data-protection terms have been approved.
      </Alert>

      <Card>
        <CardHeader title="Widget settings" />
        <CardBody>
          <ActionForm action={chatbotAction} submitLabel="Save widget settings">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Provider name (for your records)" name="provider" hint="e.g. SkillyChat"><Input defaultValue={c.provider} /></Field>
              <Field label="Show the widget on" name="scope">
                <Select defaultValue={c.scope}>
                  <option value="public">Public information pages only (recommended)</option>
                  <option value="public_and_app">Public pages and signed-in work pages</option>
                </Select>
              </Field>
            </div>
            <Field
              label="Embed code"
              name="snippet"
              hint={`Paste the <script> code from your chatbot provider's dashboard. Only <script> tags are accepted; scripts must load over HTTPS. Example: ${EXAMPLE}`}
            >
              <Textarea defaultValue={c.snippet} rows={8} className="font-mono text-xs" spellCheck={false} placeholder={EXAMPLE} />
            </Field>
            <Field
              label="Additional allowed domains (optional)"
              name="extraOrigins"
              hint="Domains the widget connects to besides the script's own domain, one per line (e.g. https://api.example.com). Add these only if the widget does not load or connect after saving; your browser's console will name the blocked domain."
            >
              <Textarea defaultValue={c.extraOrigins.join("\n")} rows={3} className="font-mono text-xs" spellCheck={false} />
            </Field>
            <div><Checkbox id="enabled" name="enabled" label="Enable the widget" defaultChecked={c.enabled} /></div>
          </ActionForm>
        </CardBody>
      </Card>

      {c.scripts.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="What will be loaded" description="Derived from the saved embed code." />
          <CardBody className="space-y-3 text-sm">
            <ul className="space-y-1">
              {c.scripts.map((s, i) => (
                <li key={i} className="font-mono text-xs break-all">{s.src ? <>script <Badge>external</Badge> {s.src}</> : <>script <Badge>inline</Badge> {s.code?.length} characters</>}</li>
              ))}
            </ul>
            <p>Allowed domains: {[...new Set([...c.origins, ...c.extraOrigins])].map((o) => <Badge key={o} className="mr-1">{o}</Badge>)}</p>
            <p className="text-muted">Pages: {PUBLIC_WIDGET_PATHS.join(", ")}{c.scope === "public_and_app" ? ", and signed-in work pages (except account and administration pages)" : ""}. Changes can take up to a minute to reach every server.</p>
          </CardBody>
        </Card>
      )}
    </>
  );
}
