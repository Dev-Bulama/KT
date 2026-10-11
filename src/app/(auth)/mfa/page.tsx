import { redirect } from "next/navigation";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input } from "@/components/ui/form";
import { getActor } from "@/modules/auth/current";
import { mfaAction } from "../actions";

export const metadata = { title: "Verification" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.mfaEnabled || actor.mfaVerified) redirect(sp.next ?? "/dashboard");
  return (
    <>
      <h1 className="text-xl font-semibold">Two-step verification</h1>
      <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      <ActionForm action={mfaAction} submitLabel="Verify" className="mt-5">
        <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
        <Field label="Verification code" name="code" required><Input inputMode="numeric" autoComplete="one-time-code" autoFocus /></Field>
      </ActionForm>
    </>
  );
}
