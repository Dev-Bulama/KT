/**
 * Explainable project risk indicators (AI Feature 5, rule-based baseline).
 * No predictive accuracy is claimed: each flag is a transparent rule with the
 * evidence that triggered it. A statistical delay model should only replace
 * these rules after validation against sufficient historical data.
 */
export interface RiskInput {
  status: string;
  plannedEndDate: Date | null;
  startedAt: Date | null;
  progressPercent: number;
  overdueMilestones: number;
  openBlockers: number;
  oldestBlockerDays: number | null;
  scopeChanges: number;
  pendingAckOverdue: number;
  openHighRisks: number;
  remediationCount: number;
  historicalMedianDurationDays: number | null;
}

export interface RiskFlag {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
}

export function assessProjectRisk(p: RiskInput, now = new Date(), scopeChangeWarning = 2): { score: number; level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; flags: RiskFlag[] } {
  const flags: RiskFlag[] = [];
  const day = 86_400_000;
  if (p.plannedEndDate && !["CLOSED", "CANCELLED", "ACCEPTED"].includes(p.status)) {
    const daysLeft = (p.plannedEndDate.getTime() - now.getTime()) / day;
    if (daysLeft < 0) flags.push({ code: "OVERDUE", severity: "HIGH", message: `Planned completion passed ${Math.ceil(-daysLeft)} day(s) ago.` });
    else if (p.startedAt) {
      const total = (p.plannedEndDate.getTime() - p.startedAt.getTime()) / day;
      const elapsedPct = total > 0 ? ((now.getTime() - p.startedAt.getTime()) / day / total) * 100 : 0;
      if (elapsedPct - p.progressPercent >= 30) {
        flags.push({ code: "PROGRESS_LAG", severity: "MEDIUM", message: `${Math.round(elapsedPct)}% of planned time elapsed but recorded progress is ${p.progressPercent}%.` });
      }
    }
  }
  if (p.overdueMilestones > 0) flags.push({ code: "MILESTONES_OVERDUE", severity: p.overdueMilestones > 1 ? "HIGH" : "MEDIUM", message: `${p.overdueMilestones} milestone(s) past due date.` });
  if (p.openBlockers > 0) flags.push({ code: "BLOCKERS", severity: (p.oldestBlockerDays ?? 0) > 7 ? "HIGH" : "MEDIUM", message: `${p.openBlockers} unresolved blocker(s)${p.oldestBlockerDays ? `, oldest ${Math.floor(p.oldestBlockerDays)} day(s)` : ""}.` });
  if (p.scopeChanges >= scopeChangeWarning) flags.push({ code: "SCOPE_CHURN", severity: "MEDIUM", message: `${p.scopeChanges} scope change requests recorded.` });
  if (p.pendingAckOverdue > 0) flags.push({ code: "UNACKNOWLEDGED", severity: "MEDIUM", message: `${p.pendingAckOverdue} assignment(s) not acknowledged in time.` });
  if (p.openHighRisks > 0) flags.push({ code: "HIGH_RISKS", severity: "HIGH", message: `${p.openHighRisks} open high/critical risk(s) in the risk register.` });
  if (p.remediationCount > 0) flags.push({ code: "REMEDIATION", severity: "MEDIUM", message: `Completion disputed by the MDA ${p.remediationCount} time(s).` });
  if (p.historicalMedianDurationDays && p.startedAt && !p.plannedEndDate) {
    const elapsed = (now.getTime() - p.startedAt.getTime()) / day;
    if (elapsed > p.historicalMedianDurationDays * 1.5) flags.push({ code: "LONG_RUNNING", severity: "MEDIUM", message: `Running ${Math.round(elapsed)} days vs. historical median ${Math.round(p.historicalMedianDurationDays)} days for this service category.` });
  }
  const score = flags.reduce((s, f) => s + (f.severity === "HIGH" ? 3 : f.severity === "MEDIUM" ? 2 : 1), 0);
  const level = score >= 8 ? "CRITICAL" : score >= 5 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
  return { score, level, flags };
}
