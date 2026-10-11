"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
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
 * Children may be a render function receiving field errors.
 */
export function ActionForm({
  action, children, submitLabel = "Save", submitVariant, className, resetOnSuccess, confirm, hideSubmit, successRedirect, inline,
}: {
  action: ServerAction;
  children?: React.ReactNode | ((errors: Record<string, string[]>) => React.ReactNode);
  submitLabel?: string;
  submitVariant?: ButtonProps["variant"];
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  hideSubmit?: boolean;
  successRedirect?: string;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
    if (state.ok && successRedirect) window.location.assign(successRedirect);
  }, [state, resetOnSuccess, successRedirect]);
  const errors = state.fieldErrors ?? {};
  return (
    <form
      ref={ref}
      action={formAction}
      className={cn(inline ? "inline-flex flex-wrap items-end gap-2" : "space-y-4", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {typeof children === "function" ? children(errors) : children}
      {state.message && !inline && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      {!hideSubmit && <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>}
      {state.message && inline && <span role="status" className={cn("text-xs", state.ok ? "text-accent-700" : "text-danger-700")}>{state.message}</span>}
    </form>
  );
}
