import Link from "next/link";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { verifyEmail } from "@/modules/auth/service";
import { resendVerificationAction } from "../actions";

export const metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ token?: string; email?: string }> }) {
  const { token, email } = await searchParams;
  if (token) {
    const r = await verifyEmail(token);
    return (
      <>
        <h1 className="text-xl font-semibold">Email verification</h1>
        <div className="mt-4"><Alert tone={r.ok ? "success" : "danger"}>{r.message}</Alert></div>
        <p className="mt-5 text-sm"><Link href="/login">Go to sign in</Link></p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-xl font-semibold">Resend verification email</h1>
      <p className="mt-1 text-sm text-muted">Didn&apos;t receive the link? Enter your email to request a new one.</p>
      <ActionForm action={resendVerificationAction} submitLabel="Send link" className="mt-5">
        <Field label="Email address" name="email" required><Input type="email" autoComplete="email" defaultValue={email ?? ""} /></Field>
      </ActionForm>
    </>
  );
}
