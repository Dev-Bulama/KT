"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { SubmitButton } from "@/components/forms/action-form";
import { Alert } from "@/components/ui/misc";
import type { ActionState } from "@/lib/action";

type B = { source: "ai" | "rules"; notice: string | null; data: { headline: string; sections: { title: string; interpretation: string; recommendedActions: string[] }[] }; facts: Record<string, unknown> };

export function BriefingPanel({ action }: { action: () => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const b = state.data?.briefing as B | undefined;
  const ov = (b?.facts.overview ?? {}) as Record<string, number | null>;
  return (
    <div className="space-y-4">
      <form action={formAction}><SubmitButton pendingText="Preparing briefing…"><Sparkles className="h-4 w-4" />Generate executive briefing</SubmitButton></form>
      {!state.ok && state.message && <Alert tone="danger">{state.message}</Alert>}
      {b && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-white p-4" aria-labelledby="facts-h">
            <h3 id="facts-h" className="text-sm font-semibold">Facts from the database</h3>
            <p className="text-xs text-muted">Retrieved with your access permissions; no interpretation.</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              {[["New requests (30 days)", b.facts.newRequests], ["Pending approvals", b.facts.pendingApprovals], ["Awaiting review", ov.awaitingReview], ["Active projects", ov.activeProjects], ["Overdue projects", ov.overdueProjects], ["High-risk projects", ov.highRiskProjects], ["Overdue milestones", b.facts.overdueMilestones], ["Unacknowledged assignments", b.facts.unacknowledgedAssignments], ["SLA breaches", b.facts.slaBreaches], ["Open complaints", b.facts.openComplaints]].map(([k, v]) => (
                <div key={String(k)}><dt className="text-xs text-muted">{String(k)}</dt><dd className="font-semibold tabular-nums">{String(v ?? "—")}</dd></div>
              ))}
            </dl>
          </section>
          <section className="rounded-[var(--radius-card)] border border-dashed border-navy-700/40 bg-navy-50/50 p-4" aria-labelledby="interp-h">
            <h3 id="interp-h" className="text-sm font-semibold">{b.source === "ai" ? "AI-generated interpretation" : "Rule-based summary"}</h3>
            <p className="text-xs text-muted">{b.notice ?? "Interpretation for discussion; verify against the facts before acting."}</p>
            <p className="mt-3 font-medium">{b.data.headline}</p>
            {b.data.sections.map((s) => (
              <div key={s.title} className="mt-3 text-sm"><p className="font-semibold">{s.title}</p><p>{s.interpretation}</p>{s.recommendedActions.length > 0 && <ul className="ml-4 list-disc text-muted">{s.recommendedActions.map((a) => <li key={a}>{a}</li>)}</ul>}</div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
