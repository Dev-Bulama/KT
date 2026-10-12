"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";
import { FormErrorsContext } from "./form-errors";

type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function SubmitButton({ children, pendingText, pending: pendingProp, ...props }: ButtonProps & { pendingText?: string; pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  // Disabled while pending: prevents accidental duplicate submissions.
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {pending ? (pendingText ?? "Working…") : children}
    </Button>
  );
}

/**
 * Generic progressive-enhancement form bound to a server action.
 * Children must be plain React nodes (Server Components cannot pass functions
 * to client components); field errors reach <Field> through FormErrorsContext.
 */
export function ActionForm({
  action, children, submitLabel = "Save", submitVariant, className, resetOnSuccess, confirm, hideSubmit, successRedirect, inline,
}: {
  action: ServerAction;
  children?: React.ReactNode;
  submitLabel?: string;
  submitVariant?: ButtonProps["variant"];
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  hideSubmit?: boolean;
  successRedirect?: string;
  inline?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, { ok: false });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // Entry forms (comments, invitations…) clear after success; edit forms keep the saved values. Failures never clear.
    if (state.ok && resetOnSuccess) ref.current?.reset();
    if (state.ok && successRedirect) window.location.assign(successRedirect);
  }, [state, resetOnSuccess, successRedirect]);
  const errors = state.fieldErrors ?? {};
  // Optional follow-up link offered by the action (same-site paths only).
  const link = state.data?.link as { href?: unknown; label?: unknown } | undefined;
  const followUp = link && typeof link.href === "string" && link.href.startsWith("/") && !link.href.startsWith("//") && typeof link.label === "string" ? { href: link.href, label: link.label } : null;
  return (
    <form
      ref={ref}
      action={formAction}
      className={cn(inline ? "inline-flex flex-wrap items-end gap-2" : "space-y-4", className)}
      onSubmit={(e) => {
        // Dispatch manually so React does not reset the form when the action fails validation.
        // Without JavaScript the native form action still works.
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      <FormErrorsContext.Provider value={errors}>{children}</FormErrorsContext.Provider>
      {state.message && !inline && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      {followUp && <p className="text-sm"><a href={followUp.href}>{followUp.label}</a></p>}
      {!hideSubmit && <SubmitButton variant={submitVariant} pending={isPending}>{submitLabel}</SubmitButton>}
      {state.message && inline && <span role="status" className={cn("text-xs", state.ok ? "text-accent-700" : "text-danger-700")}>{state.message}</span>}
    </form>
  );
}
