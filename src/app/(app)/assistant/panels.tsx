"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { SubmitButton } from "@/components/forms/action-form";
import { Textarea, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import type { ActionState } from "@/lib/action";

type Action = (p: ActionState, fd: FormData) => Promise<ActionState>;

export function AssistantPanel({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const a = state.data?.answer as { source: string; notice: string | null; data: { answer: string; citations: string[]; uncertain: boolean } } | undefined;
  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-2">
        <label htmlFor="q-assist" className="text-sm font-medium">Ask about procedures, your requests or projects</label>
        <Textarea id="q-assist" name="question" rows={3} placeholder="e.g. What happens after KATDICT requests more information?" required />
        <SubmitButton pendingText="Thinking…"><Send className="h-4 w-4" />Ask</SubmitButton>
      </form>
      {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}
      {a && (
        <div className="rounded-md border border-dashed border-navy-700/40 bg-navy-50/50 p-4 text-sm">
          <p className="text-xs font-semibold text-navy-800">{a.source === "ai" ? "AI answer — grounded in the records you can access" : "Rule-based answer (AI not used)"}</p>
          {a.notice && <p className="text-xs text-muted">{a.notice}</p>}
          {a.data.uncertain && <p className="mt-1 text-xs text-warn-700">The assistant is not certain; verify with KATDICT.</p>}
          <p className="mt-2 whitespace-pre-line">{a.data.answer}</p>
          {a.data.citations.length > 0 && <p className="mt-2 text-xs text-muted">Sources: {a.data.citations.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}

export function AnalyticsPanel({ action, examples }: { action: Action; examples: string[] }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const r = state.data?.analytics as { plan: { function: string; restatedQuestion: string }; source: string; notice: string | null; description: string; result: { columns: string[]; rows: (string | number)[][]; links: string[] } } | undefined;
  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-2">
        <label htmlFor="q-analytics" className="text-sm font-medium">Ask an analytics question</label>
        <Input id="q-analytics" name="question" placeholder="e.g. Which projects are overdue this month?" required list="analytics-examples" />
        <datalist id="analytics-examples">{examples.map((e) => <option key={e} value={e} />)}</datalist>
        <SubmitButton pendingText="Querying…">Run</SubmitButton>
      </form>
      <p className="text-xs text-muted">Questions are mapped to a fixed catalogue of permission-scoped analytics functions. No free-form database queries are executed.</p>
      {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}
      {r && (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-muted">{r.source === "ai" ? "AI selected" : "Keyword routing selected"} function <code>{r.plan.function}</code>: {r.description}.{r.notice ? ` ${r.notice}` : ""}</p>
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-navy-50 text-xs uppercase text-muted"><tr>{r.result.columns.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr></thead>
              <tbody>{r.result.rows.map((row, i) => <tr key={i} className="border-t border-line">{row.map((c, j) => <td key={j} className="px-3 py-1.5">{j === 0 && r.result.links[i] ? <Link href={r.result.links[i]}>{String(c)}</Link> : String(c)}</td>)}</tr>)}{!r.result.rows.length && <tr><td className="px-3 py-2 text-muted">No matching records.</td></tr>}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
