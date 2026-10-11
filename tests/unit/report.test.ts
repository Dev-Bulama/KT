import { describe, expect, it } from "vitest";
import { computeProjectReport, type ReportSource } from "@/modules/reports/project-report";
import { DEFAULT_CALENDAR } from "@/modules/sla/calendar";

const d = (s: string) => new Date(s);
const base: ReportSource = {
  project: { reference: "KATDICT-PRJ-2026-00001", title: "Test", approvedScope: "Scope", plannedEndDate: d("2026-10-20T12:00:00Z"), actualEndDate: d("2026-10-23T12:00:00Z"), assignedAt: d("2026-10-06T12:00:00Z"), acknowledgedAt: d("2026-10-06T13:00:00Z"), startedAt: d("2026-10-07T12:00:00Z"), completionSubmittedAt: d("2026-10-21T12:00:00Z"), acceptedAt: d("2026-10-22T12:00:00Z"), closedAt: d("2026-10-23T12:00:00Z"), remediationCount: 0 },
  request: { reference: "KATDICT-REQ-2026-00001", createdAt: d("2026-10-01T12:00:00Z"), submittedAt: d("2026-10-01T12:00:00Z"), approvedAt: d("2026-10-05T12:00:00Z"), problemStatement: "Problem" },
  mdaName: "TEST MDA", serviceName: "Web", categoryName: "Web Application Development", departmentName: "Software", projectManager: { name: "PM" }, officers: [{ name: "Officer" }],
  requestHistory: [{ toStatus: "SUBMITTED", createdAt: d("2026-10-01T12:00:00Z") }, { toStatus: "INITIAL_TRIAGE", createdAt: d("2026-10-01T13:00:00Z") }, { toStatus: "APPROVAL_REVIEW", createdAt: d("2026-10-02T12:00:00Z") }, { toStatus: "APPROVED", createdAt: d("2026-10-05T12:00:00Z") }],
  projectHistory: [{ toStatus: "APPROVED", createdAt: d("2026-10-05T12:00:00Z") }, { toStatus: "IN_PROGRESS", createdAt: d("2026-10-07T12:00:00Z") }, { toStatus: "CLOSED", createdAt: d("2026-10-23T12:00:00Z") }],
  milestones: [{ status: "COMPLETED" }, { status: "COMPLETED" }, { status: "CANCELLED" }],
  deliverables: [{ title: "App", status: "ACCEPTED", required: true }], changeRequests: 1, risks: 2,
  submissions: [{ cycle: 1, createdAt: d("2026-10-21T12:00:00Z"), status: "APPROVED", reviewedBy: { name: "Reviewer" } }],
  acceptance: [{ outcome: "ACCEPTED", createdAt: d("2026-10-22T12:00:00Z"), decidedBy: { name: "MDA Admin" } }],
  ratings: [4, 5], approvals: [{ outcome: "APPROVED", decidedBy: { name: "Tech" } }, { outcome: "APPROVED", decidedBy: { name: "Head" } }],
  firstAssignedBy: { name: "Ops" },
  closure: { closedAt: d("2026-10-23T12:00:00Z"), closureType: "STANDARD", justification: null, actualOutcome: "Done", lessonsLearned: "Involve users early", followUpRecommendations: null, closedBy: { name: "Closer" } },
};

describe("project completion report", () => {
  it("computes timeline, performance and accountability from records", () => {
    const r = computeProjectReport(base, DEFAULT_CALENDAR, d("2026-10-24T00:00:00Z"));
    expect(r.performance.calendarDaysSubmissionToClosure).toBe(22);
    expect(r.performance.plannedVsActual).toBe("LATE");
    expect(r.performance.delayDays).toBe(3);
    expect(r.performance.milestonesCompleted).toBe(2);
    expect(r.performance.milestonesTotal).toBe(2);
    expect(r.performance.reviewCycles).toBe(1);
    expect(r.performance.daysAwaitingApproval).toBeGreaterThan(0);
    expect(r.outcomes.mdaRating).toBe(4.5);
    expect(r.accountability.approvedBy.map((p) => p.name)).toEqual(["Tech", "Head"]);
    expect(r.accountability.acceptedBy?.name).toBe("MDA Admin");
    expect(r.accountability.closedBy?.name).toBe("Closer");
    expect(r.timeline.initialReview).toBe("2026-10-01T13:00:00.000Z");
  });

  it("marks unavailable values as null instead of inventing them", () => {
    const r = computeProjectReport({ ...base, project: { ...base.project, plannedEndDate: null, startedAt: null }, ratings: [], closure: null, acceptance: [], submissions: [] }, DEFAULT_CALENDAR);
    expect(r.performance.plannedVsActual).toBeNull();
    expect(r.performance.delayDays).toBeNull();
    expect(r.performance.executionDurationDays).toBeNull();
    expect(r.outcomes.mdaRating).toBeNull();
    expect(r.outcomes.lessonsLearned).toBeNull();
    expect(r.accountability.acceptedBy).toBeNull();
  });
});
