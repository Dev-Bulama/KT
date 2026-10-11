"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/forms/action-form";
import { Alert } from "@/components/ui/misc";
import type { ActionState } from "@/lib/action";

export function MfaSetup({ start, confirm }: { start: () => Promise<ActionState>; confirm: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [s1, startAction] = useActionState(start, { ok: false });
  const [s2, confirmAction] = useActionState(confirm, { ok: false });
  const codes = s2.data?.recoveryCodes as string[] | undefined;
  if (codes) {
    return (
      <div className="space-y-3">
        <Alert tone="success">{s2.message}</Alert>
        <ul className="grid grid-cols-2 gap-1 rounded-md border border-line bg-canvas p-3 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <Button onClick={() => window.location.assign("/dashboard")}>Continue</Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {!s1.ok && <form action={startAction}><SubmitButton>Set up authenticator app</SubmitButton></form>}
      {s1.message && !s1.ok && <Alert tone="danger">{s1.message}</Alert>}
      {s1.ok && (
        <>
          <p className="text-sm">{s1.message}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={String(s1.data?.qr)} alt="QR code for authenticator app setup" width={180} height={180} className="rounded border border-line" />
          <p className="text-xs text-muted">Can&apos;t scan? Enter this key manually: <code className="break-all">{String(s1.data?.secret)}</code></p>
          <form action={confirmAction} className="flex flex-wrap items-end gap-2">
            <Field label="6-digit code" name="code" required><Input inputMode="numeric" autoComplete="one-time-code" className="w-40" /></Field>
            <SubmitButton variant="accent">Verify and enable</SubmitButton>
          </form>
          {s2.message && !s2.ok && <Alert tone="danger">{s2.message}</Alert>}
        </>
      )}
    </div>
  );
}
