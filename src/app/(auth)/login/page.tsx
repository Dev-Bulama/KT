import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { getActor } from "@/modules/auth/current";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (await getActor()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use your official account to access the platform.</p>
      <div className="mt-4 space-y-3">
        {sp.signedOut && <Alert tone="success">You have been signed out.</Alert>}
        {sp.reset && <Alert tone="success">Your password was changed. Sign in with the new password.</Alert>}
        {sp.invited && <Alert tone="success">Your account is ready. Sign in to continue.</Alert>}
      </div>
      <ActionForm action={loginAction} submitLabel="Sign in" className="mt-5">
        <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />
        <Field label="Email address" name="email" required><Input type="email" autoComplete="username" /></Field>
        <Field label="Password" name="password" required><Input type="password" autoComplete="current-password" /></Field>
      </ActionForm>
      <div className="mt-5 text-sm">
        <Link href="/forgot-password">Forgot password?</Link>
      </div>
      <p className="mt-6 border-t border-line pt-4 text-sm text-muted">New MDA? <Link href="/register">Register your institution</Link></p>
    </>
  );
}
