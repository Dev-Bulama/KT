import type { Priority } from "@/generated/prisma/enums";

/**
 * Approval policy evaluation (pure functions).
 *
 * A policy has ordered steps. A step APPLIES to a request when it has no
 * thresholds, or when ANY of its configured thresholds is met
 * (priority ≥ minPriority, cost ≥ minEstimatedCostNgn, effort ≥ minEstimatedEffortDays).
 * Applicable steps must be approved in sequence within the current cycle.
 */

export const PRIORITY_RANK: Record<Priority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export interface PolicyStep {
  id: string;
  sequence: number;
  name: string;
  requiredPermission: string;
  minPriority: Priority | null;
  minEstimatedCostNgn: number | null;
  minEstimatedEffortDays: number | null;
}

export interface RequestFacts {
  priority: Priority | null;
  estimatedCostNgn: number | null;
  estimatedEffortDays: number | null;
}

export function stepApplies(step: PolicyStep, req: RequestFacts): boolean {
  const thresholds: boolean[] = [];
  if (step.minPriority) thresholds.push(!!req.priority && PRIORITY_RANK[req.priority] >= PRIORITY_RANK[step.minPriority]);
  if (step.minEstimatedCostNgn !== null) thresholds.push(req.estimatedCostNgn !== null && req.estimatedCostNgn >= step.minEstimatedCostNgn);
  if (step.minEstimatedEffortDays !== null) thresholds.push(req.estimatedEffortDays !== null && req.estimatedEffortDays >= step.minEstimatedEffortDays);
  return thresholds.length === 0 || thresholds.some(Boolean);
}

export function applicableSteps(steps: PolicyStep[], req: RequestFacts): PolicyStep[] {
  return [...steps].sort((a, b) => a.sequence - b.sequence).filter((s) => stepApplies(s, req));
}

export interface Decision {
  stepId: string;
  outcome: "APPROVED" | "REJECTED" | "RETURNED";
}

export type ApprovalState =
  | { state: "pending"; nextStep: PolicyStep; completed: PolicyStep[] }
  | { state: "approved"; completed: PolicyStep[] }
  | { state: "rejected"; step: PolicyStep }
  | { state: "returned"; step: PolicyStep }
  | { state: "no_steps" };

/** Evaluates the approval state for the current cycle's decisions. */
export function evaluateApproval(steps: PolicyStep[], req: RequestFacts, decisions: Decision[]): ApprovalState {
  const applicable = applicableSteps(steps, req);
  if (applicable.length === 0) return { state: "no_steps" };
  const completed: PolicyStep[] = [];
  for (const step of applicable) {
    const d = decisions.find((x) => x.stepId === step.id);
    if (!d) return { state: "pending", nextStep: step, completed };
    if (d.outcome === "REJECTED") return { state: "rejected", step };
    if (d.outcome === "RETURNED") return { state: "returned", step };
    completed.push(step);
  }
  return { state: "approved", completed };
}
