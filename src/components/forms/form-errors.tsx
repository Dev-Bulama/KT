"use client";

import { createContext, useContext } from "react";

/** Field-level validation errors from the most recent server action, keyed by field name. */
export const FormErrorsContext = createContext<Record<string, string[]>>({});

/** Renders explicit errors, or errors for `name` from the enclosing ActionForm. */
export function FieldErrorText({ name, id, explicit }: { name: string; id: string; explicit?: string[] }) {
  const ctx = useContext(FormErrorsContext)[name];
  const errs = explicit && explicit.length ? explicit : (ctx ?? []);
  if (!errs.length) return null;
  return <p id={id} className="text-xs text-danger-700" role="alert">{errs.join(" ")}</p>;
}
