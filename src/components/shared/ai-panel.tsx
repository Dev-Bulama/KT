"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { SubmitButton } from "@/components/forms/action-form";
import { Alert } from "@/components/ui/misc";
import type { ActionState } from "@/lib/action";

type Result = { source: "ai" | "rules"; notice: string | null; data: Record<string, unknown> };

function List({ title, items }: { title: string; items?: unknown }) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{arr.map((x, i) => <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>)}</ul>
    </div>
  );
}

/** Calls an AI server action and renders the structured suggestion. Clearly labelled; never applied automatically. */
export function AiPanel({ action, id, label, kind }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; id: string; label: string; kind: "classification" | "quality" }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const r = state.data?.result as Result | undefined;
  const d = r?.data ?? {};
  return (
    <div className="space-y-3 text-sm">
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <SubmitButton variant="secondary" size="sm" pendingText="Analysing…"><Sparkles className="h-4 w-4" aria-hidden />{label}</SubmitButton>
      </form>
      {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}
      {r && (
        <div className="space-y-3 rounded-md border border-dashed border-navy-700/40 bg-navy-50/50 p-3">
          <p className="text-xs font-semibold text-navy-800">{r.source === "ai" ? "AI-generated suggestion — for human review" : "Rule-based analysis (AI not used)"}</p>
          {r.notice && <p className="text-xs text-muted">{r.notice}</p>}
          {kind === "classification" && (
            <>
              <p><span className="text-muted">Suggested category:</span> {String(d.categoryName ?? "—")} · <span className="text-muted">Department:</span> {String(d.departmentName ?? "—")}</p>
              <p><span className="text-muted">Technical domain:</span> {String(d.technicalDomain ?? "—")}</p>
              <List title="Urgency indicators" items={d.urgencyIndicators} />
              <List title="Potential risks" items={d.potentialRisks} />
              <List title="Missing information" items={d.missingInformation} />
              <List title="Suggested assessment questions" items={d.assessmentQuestions} />
              {d.rationale ? <p className="text-xs text-muted">Rationale: {String(d.rationale)}</p> : null}
            </>
          )}
          {kind === "quality" && (
            <>
              <p><span className="text-muted">Completeness score:</span> <strong>{String(d.overallScore ?? "—")}</strong>/100 — {String(d.summary ?? "")}</p>
              {Array.isArray(d.issues) && d.issues.length > 0 && (
                <ul className="space-y-1">{(d.issues as { field: string; problem: string; suggestion: string }[]).map((x, i) => <li key={i}><strong>{x.field}:</strong> {x.problem}. <span className="text-muted">{x.suggestion}</span></li>)}</ul>
              )}
              {Array.isArray(d.possibleDuplicates) && d.possibleDuplicates.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Similar requests (indicator only — not proof of duplication)</p>
                  <ul className="mt-1 space-y-0.5">{(d.possibleDuplicates as { id: string; reference: string; title: string; score: number; mda: { abbreviation: string } }[]).map((x) => <li key={x.id}><a href={`/requests/${x.id}`}>{x.reference}</a> {x.title} ({x.mda.abbreviation}) · similarity {Math.round(x.score * 100)}%</li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
