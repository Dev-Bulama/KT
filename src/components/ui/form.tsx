import * as React from "react";
import { cn } from "@/lib/utils";

const field = "block w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-100 disabled:bg-slate-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, "h-10", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-24", className)} {...p} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(field, "h-10", className)} {...p} />
));
Select.displayName = "Select";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium text-ink", className)} {...p} />;
}

/** Accessible field wrapper: label, hint and error wired with aria-describedby. */
export function Field({ label, name, hint, error, required, children, className }: {
  label: string; name: string; hint?: string; error?: string[] | string; required?: boolean; children: React.ReactElement<Record<string, unknown>>; className?: string;
}) {
  const errs = Array.isArray(error) ? error : error ? [error] : [];
  const hintId = hint ? `${name}-hint` : undefined;
  const errId = errs.length ? `${name}-error` : undefined;
  const child = React.cloneElement(children, {
    id: (children.props.id as string) ?? name,
    name: (children.props.name as string) ?? name,
    "aria-invalid": errs.length ? true : undefined,
    "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined,
    required: (children.props.required as boolean) ?? required,
  });
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={(children.props.id as string) ?? name}>
        {label}
        {required && <span className="text-danger-700" aria-hidden> *</span>}
      </Label>
      {child}
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {errs.length > 0 && <p id={errId} className="text-xs text-danger-700" role="alert">{errs.join(" ")}</p>}
    </div>
  );
}

export function Checkbox({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 rounded border-line text-navy-900" {...p} />
      {label}
    </label>
  );
}
