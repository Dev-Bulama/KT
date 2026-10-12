import { requirePageActor } from "@/modules/auth/current";
import { getEmailConfigView } from "@/modules/notifications/email-config";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDateTime } from "@/lib/utils";
import { emailConfigAction, testEmailAction } from "../site-actions";

export const metadata = { title: "Email delivery" };

export default async function EmailDelivery() {
  const actor = await requirePageActor("system.notifications.manage");
  const c = await getEmailConfigView(actor);
  return (
    <>
      <PageHeader
        title="Email delivery (SMTP)"
        description="Choose how the platform sends email: through your organisation's SMTP server, or through the provider set in the deployment's environment variables."
      />
      <Alert tone="info" className="mb-4">
        Currently active: <strong>{c.mode === "smtp" && c.host ? `SMTP (${c.host}:${c.port})` : `environment configuration (EMAIL_PROVIDER=${c.envProvider})`}</strong>
        {c.updatedAt ? <> · last changed {formatDateTime(c.updatedAt)}</> : null}. Emails are queued and sent by the delivery job every few minutes, so changes apply to the next delivery run.
      </Alert>

      <Card className="mb-6">
        <CardHeader title="SMTP settings" description="Ask your email administrator for these values (for Google Workspace, Microsoft 365, Zoho or your own mail server)." />
        <CardBody>
          <ActionForm action={emailConfigAction} submitLabel="Save email settings">
            <Field label="Delivery method" name="mode" required>
              <Select defaultValue={c.mode}>
                <option value="smtp">SMTP server (settings below)</option>
                <option value="env">Environment configuration ({c.envProvider})</option>
              </Select>
            </Field>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="SMTP host" name="host" hint="e.g. smtp.office365.com, smtp.gmail.com, mail.example.gov.ng" className="md:col-span-2"><Input defaultValue={c.host} autoComplete="off" /></Field>
              <Field label="Port" name="port" hint="587 (STARTTLS) or 465 (TLS)"><Input type="number" defaultValue={String(c.port)} min={1} max={65535} /></Field>
              <Field label="Encryption" name="security">
                <Select defaultValue={c.security}>
                  <option value="starttls">STARTTLS (port 587)</option>
                  <option value="tls">SSL/TLS (port 465)</option>
                  <option value="none">None — development only</option>
                </Select>
              </Field>
              <Field label="Username" name="username" hint="Usually the full mailbox address" className="md:col-span-2"><Input defaultValue={c.username} autoComplete="off" /></Field>
              <Field label="Password / app password" name="password" hint={c.hasPassword ? "A password is saved. Leave blank to keep it." : "No password saved."} className="md:col-span-2">
                <Input type="password" autoComplete="new-password" placeholder={c.hasPassword ? "••••••••  (unchanged)" : ""} />
              </Field>
              <Field label="Sender name" name="fromName" hint="e.g. KATDICT Service Desk" className="md:col-span-2"><Input defaultValue={c.fromName} /></Field>
              <Field label="Sender email address" name="fromEmail" hint="Must be allowed to send through this SMTP account" className="md:col-span-2"><Input type="email" defaultValue={c.fromEmail} /></Field>
              <Field label="Reply-to address (optional)" name="replyTo" className="md:col-span-2"><Input type="email" defaultValue={c.replyTo} /></Field>
              {c.hasPassword && <div className="flex items-end pb-2 md:col-span-2"><Checkbox id="clearPassword" name="clearPassword" label="Remove the saved password" /></div>}
            </div>
            <p className="text-xs text-muted">The password is encrypted before it is stored, is never shown again, and is excluded from audit records.</p>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Send a test email" description="Connects with the saved settings and sends one message immediately, showing any error from the mail server. Save your settings first." />
        <CardBody>
          <ActionForm action={testEmailAction} submitLabel="Send test email" submitVariant="secondary" inline>
            <Field label="Recipient" name="to"><Input type="email" defaultValue={actor.email} className="w-72" /></Field>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
