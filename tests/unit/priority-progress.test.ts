import { describe, expect, it } from "vitest";
import { suggestPriority } from "@/modules/catalog/priority";
import { calculateProgress } from "@/modules/projects/progress";

describe("priority rules", () => {
  const rules = [{ when: { urgency: "CRITICAL" }, priority: "CRITICAL" }, { when: { estimatedUsersGte: 1000 }, priority: "HIGH" }, { when: { hasLegalConsiderations: true }, priority: "HIGH" }];
  it("never goes below the service default", () => {
    expect(suggestPriority("HIGH", rules, { urgency: "LOW", estimatedUsers: 1, legalConsiderations: null }).priority).toBe("HIGH");
  });
  it("highest matching rule wins", () => {
    expect(suggestPriority("LOW", rules, { urgency: "CRITICAL", estimatedUsers: 5000, legalConsiderations: "Act" }).priority).toBe("CRITICAL");
    expect(suggestPriority("LOW", rules, { urgency: "LOW", estimatedUsers: 5000, legalConsiderations: null }).priority).toBe("HIGH");
  });
  it("ignores invalid rule JSON safely", () => {
    const r = suggestPriority("MEDIUM", [{ when: { evil: true }, priority: "CRITICAL" }], { urgency: "LOW", estimatedUsers: null, legalConsiderations: null });
    expect(r.priority).toBe("MEDIUM");
    expect(r.reasons.join(" ")).toMatch(/invalid/);
  });
});

describe("progress calculation", () => {
  const ms = [{ id: "a", weight: 1, status: "COMPLETED" as const }, { id: "b", weight: 3, status: "IN_PROGRESS" as const }];
  const tasks = [
    { weight: 1, status: "DONE" as const, milestoneId: "b" },
    { weight: 1, status: "TODO" as const, milestoneId: "b" },
    { weight: 1, status: "CANCELLED" as const, milestoneId: "b" },
  ];
  it("weighted milestones", () => {
    expect(calculateProgress("WEIGHTED_MILESTONES", ms, tasks)).toBe(25);
  });
  it("weighted tasks ignore cancelled", () => {
    expect(calculateProgress("WEIGHTED_TASKS", ms, tasks)).toBe(50);
  });
  it("hybrid gives partial milestone credit from tasks", () => {
    // (1 + 3*0.5) / 4 = 62.5 → 62
    expect(calculateProgress("HYBRID", ms, tasks)).toBe(62);
  });
  it("is 100 only when everything is complete", () => {
    expect(calculateProgress("HYBRID", [{ id: "a", weight: 1, status: "IN_PROGRESS" }], [{ weight: 1, status: "DONE", milestoneId: "a" }])).toBeLessThan(100);
    expect(calculateProgress("HYBRID", [{ id: "a", weight: 1, status: "COMPLETED" }], [])).toBe(100);
  });
  it("empty plans report 0", () => {
    expect(calculateProgress("HYBRID", [], [])).toBe(0);
  });
});
