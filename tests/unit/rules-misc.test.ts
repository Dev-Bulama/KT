import { describe, expect, it } from "vitest";
import { checkAssignmentEligibility, wouldCreateCycle } from "@/modules/projects/eligibility";
import { assessProjectRisk } from "@/modules/intelligence/risk";
import { clusters, jaccard, tokens } from "@/modules/intelligence/similarity";
import { validateRolePermissions } from "@/modules/admin/users";
import { DEFAULT_ROLES, KATDICT_ONLY_PERMISSIONS } from "@/modules/rbac/permissions";
import { classificationSchema, routeQuestion, analyticsPlanSchema } from "@/modules/ai/features";
import { riskLevelFromScore } from "@/modules/projects/delivery";

const officer = { id: "o", status: "ACTIVE", userType: "KATDICT_STAFF", departmentId: "d1", permissions: new Set(["project.update", "project.completion.submit"]), activeAssignments: 1, maxConcurrentProjects: 3 };

describe("assignment eligibility", () => {
  it("accepts an eligible officer", () => expect(checkAssignmentEligibility(officer, { role: "PROJECT_MANAGER" }).eligible).toBe(true));
  it("rejects MDA users, inactive users and non-delivery roles", () => {
    expect(checkAssignmentEligibility({ ...officer, userType: "MDA_USER" }, { role: "OFFICER" }).eligible).toBe(false);
    expect(checkAssignmentEligibility({ ...officer, status: "SUSPENDED" }, { role: "OFFICER" }).eligible).toBe(false);
    expect(checkAssignmentEligibility({ ...officer, permissions: new Set() }, { role: "OFFICER" }).eligible).toBe(false);
  });
  it("enforces department restriction and capacity", () => {
    expect(checkAssignmentEligibility(officer, { role: "OFFICER", restrictToDepartmentId: "d2" }).eligible).toBe(false);
    expect(checkAssignmentEligibility({ ...officer, activeAssignments: 3 }, { role: "OFFICER" }).eligible).toBe(false);
    expect(checkAssignmentEligibility({ ...officer, activeAssignments: 3 }, { role: "OFFICER", allowOverCapacity: true }).eligible).toBe(true);
  });
});

describe("task dependency cycles", () => {
  it("detects direct and indirect cycles", () => {
    const edges = [{ taskId: "b", dependsOnId: "a" }, { taskId: "c", dependsOnId: "b" }];
    expect(wouldCreateCycle(edges, "a", "c")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "d", "c")).toBe(false);
  });
});

describe("risk indicators", () => {
  const base = { status: "IN_PROGRESS", plannedEndDate: null, startedAt: null, progressPercent: 0, overdueMilestones: 0, openBlockers: 0, oldestBlockerDays: null, scopeChanges: 0, pendingAckOverdue: 0, openHighRisks: 0, remediationCount: 0, historicalMedianDurationDays: null };
  it("is low with no signals", () => expect(assessProjectRisk(base).level).toBe("LOW"));
  it("explains each flag", () => {
    const r = assessProjectRisk({ ...base, plannedEndDate: new Date(Date.now() - 5 * 86400000), overdueMilestones: 2, openBlockers: 1, oldestBlockerDays: 10 });
    expect(r.level).toMatch(/HIGH|CRITICAL/);
    expect(r.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["OVERDUE", "MILESTONES_OVERDUE", "BLOCKERS"]));
  });
  it("maps L×I scores to levels", () => {
    expect(riskLevelFromScore(4)).toBe("LOW");
    expect(riskLevelFromScore(12)).toBe("HIGH");
    expect(riskLevelFromScore(25)).toBe("CRITICAL");
  });
});

describe("similarity (indicator only)", () => {
  it("scores similar texts higher", () => {
    const a = tokens("Inventory and stores management system for stock tracking");
    expect(jaccard(a, tokens("Stores inventory management system to track stock"))).toBeGreaterThan(jaccard(a, tokens("Staff leave application portal")));
  });
  it("clusters only across different groups", () => {
    const c = clusters([
      { id: "1", text: "inventory stores stock management", group: "A" },
      { id: "2", text: "stores inventory stock management", group: "B" },
      { id: "3", text: "inventory stock stores management", group: "A" },
      { id: "4", text: "leave application staff portal", group: "C" },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].docs.map((d) => d.id).sort()).toEqual(["1", "2", "3"]);
  });
});

describe("role permission guardrails", () => {
  it("default roles satisfy their own guardrails", () => {
    for (const r of DEFAULT_ROLES) expect(validateRolePermissions(r, r.permissions), r.key).toEqual([]);
  });
  it("blocks KATDICT permissions on MDA roles and writes on oversight roles", () => {
    expect(validateRolePermissions({ key: "MDA_ADMIN", userType: "MDA_USER" }, ["request.approve.executive"]).length).toBeGreaterThan(0);
    expect(validateRolePermissions({ key: "AUDITOR", userType: "OVERSIGHT" }, ["project.close"]).length).toBeGreaterThan(0);
    expect(validateRolePermissions({ key: "SUPER_ADMIN", userType: "KATDICT_STAFF" }, ["audit.read"]).length).toBeGreaterThan(0);
    expect(validateRolePermissions({ key: "X", userType: "KATDICT_STAFF" }, ["made.up"]).length).toBeGreaterThan(0);
  });
  it("MDA roles never hold KATDICT-only permissions", () => {
    for (const r of DEFAULT_ROLES.filter((x) => x.userType === "MDA_USER")) {
      expect(r.permissions.filter((p) => KATDICT_ONLY_PERMISSIONS.includes(p)), r.key).toEqual([]);
    }
  });
});

describe("AI output validation and routing", () => {
  it("rejects malformed model output", () => {
    expect(classificationSchema.safeParse({ suggestedCategoryCode: 1 }).success).toBe(false);
    expect(analyticsPlanSchema.safeParse({ function: "drop_table", params: {}, restatedQuestion: "" }).success).toBe(false);
  });
  it("routes questions to whitelisted analytics functions", () => {
    expect(routeQuestion("Which projects are overdue this month?")).toMatchObject({ function: "overdue_projects", params: { thisMonthOnly: true } });
    expect(routeQuestion("Which MDAs have the highest number of unresolved ICT requests?").function).toBe("mdas_unresolved_requests");
    expect(routeQuestion("How many cybersecurity requests are currently under assessment?")).toMatchObject({ function: "requests_by_category", params: { status: "UNDER_ASSESSMENT", categoryKeyword: "cybersecurity" } });
    expect(routeQuestion("Which departments have the highest project backlog?").function).toBe("department_backlog");
    expect(routeQuestion("Show completed projects with delayed delivery.").function).toBe("completed_delayed_projects");
    expect(routeQuestion("Summarize the major ICT delivery risks for this quarter.").function).toBe("risk_summary");
  });
});
