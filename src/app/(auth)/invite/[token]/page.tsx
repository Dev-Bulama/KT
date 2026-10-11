import { ActionForm } from "@/components/forms/action-form";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { humanize } from "@/lib/utils";
import { getInvitationByToken } from "@/modules/mdas/service";
import { acceptInviteAction } from "../../actions";

export const metadata = { title: "Accept invitation" };

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvitationByToken(token);
  if (!inv) return <Alert tone="danger" title="Invitation unavailable">This invitation is invalid, has expired or was already used. Ask your administrator to send a new one.</Alert>;
  return (
    <>
      <h1 className="text-xl font-semibold">Accept invitation</h1>
      <p className="mt-1 text-sm text-muted">
        You are joining {inv.mdaName ? <strong>{inv.mdaName}</strong> : "KATDICT"} as {inv.roleKeys.map(humanize).join(", ")}. Account email: <strong>{inv.email}</strong>
      </p>
      <ActionForm action={acceptInviteAction} submitLabel="Create my account" className="mt-5">
        {(e) => (
          <>
            <input type="hidden" name="token" value={token} />
            <Field label="Full name" name="name" required><Input defaultValue={inv.name ?? ""} autoComplete="name" /></Field>
            <Field label="Designation" name="designation"><Input /></Field>
            <Field label="Telephone" name="phone"><Input type="tel" autoComplete="tel" /></Field>
            <Field label="Password" name="password" required hint="At least 12 characters with upper-case, lower-case letters and a number." error={e.password}><Input type="password" autoComplete="new-password" /></Field>
            <Field label="Confirm password" name="confirmPassword" required><Input type="password" autoComplete="new-password" /></Field>
          </>
        )}
      </ActionForm>
    </>
  );
}
