import Link from "next/link";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <Alert tone="danger" title="Invalid link">This password reset link is incomplete. <Link href="/forgot-password">Request a new one</Link>.</Alert>;
  return (
    <>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} submitLabel="Update password" className="mt-5">
        <>
            <input type="hidden" name="token" value={token} />
            <Field label="New password" name="password" required hint="At least 12 characters with upper-case, lower-case letters and a number."><Input type="password" autoComplete="new-password" /></Field>
            <Field label="Confirm password" name="confirmPassword" required><Input type="password" autoComplete="new-password" /></Field>
          </>
      </ActionForm>
    </>
  );
}
