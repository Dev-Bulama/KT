import { redirect } from "next/navigation";
import { getActor } from "@/modules/auth/current";
import { listSessions } from "@/modules/auth/service";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDateTime, humanize } from "@/lib/utils";
import { changePasswordAction, confirmMfaAction, disableMfaAction, revokeSessionAction, startMfaAction } from "./actions";
import { MfaSetup } from "./mfa-setup";

export const metadata = { title: "Account & security" };

export default async function Security({ searchParams }: { searchParams: Promise<{ enroll?: string }> }) {
  const { enroll } = await searchParams;
  // Uses getActor (not requirePageActor): privileged users must reach this page to enrol MFA.
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mfaEnabled && !actor.mfaVerified) redirect("/mfa?next=/account/security");
  const sessions = await listSessions(actor);
  return (
    <>
      <PageHeader title="Account & security" description={`${actor.name} · ${actor.email} · ${actor.roles.map(humanize).join(", ")}`} />
      {enroll && !actor.mfaEnabled && <Alert tone="warning" className="mb-4" title="Multi-factor authentication required">Your role requires an authenticator app before you can use the platform.</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Multi-factor authentication" actions={actor.mfaEnabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="warning">Not enabled</Badge>} /><CardBody>
          {actor.mfaEnabled ? (
            <ActionForm action={disableMfaAction} submitLabel="Disable MFA" submitVariant="secondary" confirm="Disable multi-factor authentication?">
              <p className="text-sm text-muted">MFA protects your account with a time-based code. Privileged roles cannot disable it while the policy requires it.</p>
              <Field label="Confirm with your password" name="password" required><Input type="password" autoComplete="current-password" /></Field>
            </ActionForm>
          ) : <MfaSetup start={startMfaAction} confirm={confirmMfaAction} />}
        </CardBody></Card>
        <Card><CardHeader title="Change password" /><CardBody>
          <ActionForm action={changePasswordAction} submitLabel="Change password" resetOnSuccess>
            <Field label="Current password" name="current" required><Input type="password" autoComplete="current-password" /></Field>
            <Field label="New password" name="next" required hint="At least 12 characters with upper-case, lower-case letters and a number."><Input type="password" autoComplete="new-password" /></Field>
            <Field label="Confirm new password" name="confirm" required><Input type="password" autoComplete="new-password" /></Field>
          </ActionForm>
        </CardBody></Card>
        <Card className="lg:col-span-2"><CardHeader title="Active sessions" description="Sign out sessions you do not recognise." /><CardBody>
          <ul className="divide-y divide-line text-sm">{sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{s.userAgent?.slice(0, 80) ?? "Unknown device"} <span className="text-xs text-muted">· {s.ip ?? "unknown IP"} · signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.lastSeenAt)}</span>{s.id === actor.sessionId && <Badge tone="info" className="ml-2">This session</Badge>}</span>
              {s.id !== actor.sessionId && <ActionForm inline action={revokeSessionAction} submitLabel="Sign out" submitVariant="ghost"><input type="hidden" name="sessionId" value={s.id} /></ActionForm>}
            </li>
          ))}</ul>
        </CardBody></Card>
      </div>
    </>
  );
}
