"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/forms/action-form";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import type { ActionState } from "@/lib/action";

type Plan = { rows: { line: number; name: string; abbreviation: string; action: string; errors: string[] }[]; errorCount: number; headerErrors: string[] };

export function ImportForm({ action }: { action: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [apply, setApply] = useState(false);
  const plan = state.data?.plan as Plan | undefined;
  return (
    <form action={formAction} className="space-y-4" onSubmit={(e) => { if (apply && !confirm("Apply this import to the live MDA directory?")) e.preventDefault(); }}>
      <input type="hidden" name="apply" value={apply ? "true" : "false"} />
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" name="file" accept=".csv,text/csv" required aria-label="Verified MDA directory CSV" className="text-sm" />
        <SubmitButton variant="secondary" onClick={() => setApply(false)}>Validate (dry run)</SubmitButton>
        {plan && plan.errorCount === 0 && plan.rows.length > 0 && <SubmitButton variant="accent" onClick={() => setApply(true)}>Import {plan.rows.length} rows</SubmitButton>}
      </div>
      {state.message && <Alert tone={state.ok && !(plan?.errorCount) ? "success" : "warning"}>{state.message}</Alert>}
      {plan?.headerErrors.map((h) => <Alert key={h} tone="danger">{h}</Alert>)}
      {plan && plan.rows.length > 0 && (
        <div className="max-h-[480px] overflow-auto rounded-md border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-navy-50 text-xs uppercase text-muted"><tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Abbreviation</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Issues</th></tr></thead>
            <tbody>{plan.rows.map((r) => (
              <tr key={r.line} className="border-t border-line"><td className="px-3 py-1.5">{r.line}</td><td className="px-3 py-1.5">{r.abbreviation}</td><td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5"><Badge tone={r.action === "error" ? "danger" : r.action === "create" ? "success" : "info"}>{r.action}</Badge></td><td className="px-3 py-1.5 text-xs text-danger-700">{r.errors.join("; ")}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </form>
  );
}
