import Link from "next/link";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input } from "@/components/ui/form";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Reset password" };

export default function ForgotPassword() {
  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-muted">Enter your account email. If an active account exists, we will send a reset link valid for 60 minutes.</p>
      <ActionForm action={forgotPasswordAction} submitLabel="Send reset link" className="mt-5" resetOnSuccess>
        <Field label="Email address" name="email" required><Input type="email" autoComplete="email" /></Field>
      </ActionForm>
      <p className="mt-5 text-sm"><Link href="/login">Back to sign in</Link></p>
    </>
  );
}
