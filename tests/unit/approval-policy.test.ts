import { describe, expect, it } from "vitest";
import { applicableSteps, evaluateApproval, stepApplies, type PolicyStep } from "@/modules/approvals/policy";

const steps: PolicyStep[] = [
  { id: "t", sequence: 1, name: "Technical", requiredPermission: "request.approve.technical", minPriority: null, minEstimatedCostNgn: null, minEstimatedEffortDays: null },
  { id: "d", sequence: 2, name: "Department", requiredPermission: "request.approve.department", minPriority: null, minEstimatedCostNgn: null, minEstimatedEffortDays: null },
  { id: "e", sequence: 3, name: "Executive", requiredPermission: "request.approve.executive", minPriority: "HIGH", minEstimatedCostNgn: 50_000_000, minEstimatedEffortDays: 90 },
];

describe("approval thresholds", () => {
  it("steps without thresholds always apply", () => {
    expect(stepApplies(steps[0], { priority: null, estimatedCostNgn: null, estimatedEffortDays: null })).toBe(true);
  });
  it("threshold steps apply when ANY threshold is met", () => {
    expect(stepApplies(steps[2], { priority: "MEDIUM", estimatedCostNgn: 1_000, estimatedEffortDays: 10 })).toBe(false);
    expect(stepApplies(steps[2], { priority: "HIGH", estimatedCostNgn: 1_000, estimatedEffortDays: 10 })).toBe(true);
    expect(stepApplies(steps[2], { priority: "LOW", estimatedCostNgn: 60_000_000, estimatedEffortDays: 10 })).toBe(true);
    expect(stepApplies(steps[2], { priority: "LOW", estimatedCostNgn: null, estimatedEffortDays: 90 })).toBe(true);
    expect(stepApplies(steps[2], { priority: "CRITICAL", estimatedCostNgn: null, estimatedEffortDays: null })).toBe(true);
  });
  it("orders by sequence", () => {
    expect(applicableSteps([...steps].reverse(), { priority: "LOW", estimatedCostNgn: 0, estimatedEffortDays: 1 }).map((s) => s.id)).toEqual(["t", "d"]);
  });
});

describe("approval evaluation", () => {
  const low = { priority: "MEDIUM" as const, estimatedCostNgn: 1_000_000, estimatedEffortDays: 20 };
  const high = { priority: "HIGH" as const, estimatedCostNgn: 1_000_000, estimatedEffortDays: 20 };
  it("progresses step by step", () => {
    expect(evaluateApproval(steps, low, [])).toMatchObject({ state: "pending", nextStep: { id: "t" } });
    expect(evaluateApproval(steps, low, [{ stepId: "t", outcome: "APPROVED" }])).toMatchObject({ state: "pending", nextStep: { id: "d" } });
    expect(evaluateApproval(steps, low, [{ stepId: "t", outcome: "APPROVED" }, { stepId: "d", outcome: "APPROVED" }])).toMatchObject({ state: "approved" });
  });
  it("requires executive approval above threshold", () => {
    expect(evaluateApproval(steps, high, [{ stepId: "t", outcome: "APPROVED" }, { stepId: "d", outcome: "APPROVED" }])).toMatchObject({ state: "pending", nextStep: { id: "e" } });
  });
  it("rejection or return at any step ends the cycle", () => {
    expect(evaluateApproval(steps, low, [{ stepId: "t", outcome: "REJECTED" }])).toMatchObject({ state: "rejected" });
    expect(evaluateApproval(steps, low, [{ stepId: "t", outcome: "APPROVED" }, { stepId: "d", outcome: "RETURNED" }])).toMatchObject({ state: "returned" });
  });
  it("reports missing policy", () => {
    expect(evaluateApproval([], low, [])).toEqual({ state: "no_steps" });
  });
});
