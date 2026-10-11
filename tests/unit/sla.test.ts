import { describe, expect, it } from "vitest";
import { addWorkingDays, DEFAULT_CALENDAR, workingDaysBetween } from "@/modules/sla/calendar";
import { evaluateSla, timeBreakdown } from "@/modules/sla/sla";

// 2026-10-05 is a Monday. Times are WAT (UTC+1); 23:00Z = 00:00 WAT next day.
const d = (s: string) => new Date(s);

describe("business calendar", () => {
  it("counts only working days", () => {
    // Mon 00:00 WAT → next Mon 00:00 WAT = 5 working days
    expect(workingDaysBetween(d("2026-10-04T23:00:00Z"), d("2026-10-11T23:00:00Z"), DEFAULT_CALENDAR)).toBeCloseTo(5);
  });
  it("excludes configured holidays", () => {
    const cal = { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-10-07"] };
    expect(workingDaysBetween(d("2026-10-04T23:00:00Z"), d("2026-10-11T23:00:00Z"), cal)).toBeCloseTo(4);
  });
  it("adds working days skipping weekends", () => {
    // Friday 12:00 WAT + 1 working day → Monday 12:00 WAT (weekend skipped)
    const r = addWorkingDays(d("2026-10-09T11:00:00Z"), 1, DEFAULT_CALENDAR);
    expect(r.toISOString()).toBe("2026-10-12T11:00:00.000Z");
  });
});

describe("time breakdown and SLA", () => {
  const history = [
    { toStatus: "SUBMITTED", createdAt: d("2026-10-04T23:00:00Z") }, // Mon
    { toStatus: "NEEDS_INFORMATION", createdAt: d("2026-10-05T23:00:00Z") }, // Tue
    { toStatus: "UNDER_ASSESSMENT", createdAt: d("2026-10-07T23:00:00Z") }, // Thu
  ];
  it("separates paused time awaiting the MDA", () => {
    const t = timeBreakdown(history, history[0].createdAt, d("2026-10-09T23:00:00Z"), ["NEEDS_INFORMATION"], DEFAULT_CALENDAR);
    expect(t.workingDays).toBeCloseTo(5);
    expect(t.pausedWorkingDays).toBeCloseTo(2);
    expect(t.activeWorkingDays).toBeCloseTo(3);
    expect(t.byStatus.NEEDS_INFORMATION).toBeCloseTo(2);
  });
  it("evaluates SLA states", () => {
    expect(evaluateSla(3, 10, false).state).toBe("ON_TRACK");
    expect(evaluateSla(8, 10, false).state).toBe("AT_RISK");
    expect(evaluateSla(11, 10, false).state).toBe("BREACHED");
    expect(evaluateSla(9, 10, true).state).toBe("MET");
    expect(evaluateSla(9, null, true).state).toBe("NOT_APPLICABLE");
  });
});
