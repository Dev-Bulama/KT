import { type BusinessCalendar, calendarDaysBetween, workingMsBetween } from "./calendar";

const DAY_MS = 86_400_000;

export interface StatusEvent<S extends string = string> {
  toStatus: S;
  createdAt: Date;
}

export interface TimeBreakdown {
  calendarDays: number;
  workingDays: number;
  /** Working days spent in paused statuses (e.g. awaiting MDA information). */
  pausedWorkingDays: number;
  /** Working days counted against the SLA (workingDays − pausedWorkingDays). */
  activeWorkingDays: number;
  /** Working days per status. */
  byStatus: Record<string, number>;
}

/**
 * Splits elapsed time between `from` and `until` by status, using the status
 * history (each event marks entry into `toStatus`). Pure and deterministic.
 */
export function timeBreakdown<S extends string>(
  history: StatusEvent<S>[],
  from: Date,
  until: Date,
  paused: readonly S[],
  cal: BusinessCalendar,
): TimeBreakdown {
  const events = [...history].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const byStatus: Record<string, number> = {};
  let pausedMs = 0;
  let totalMs = 0;
  for (let i = 0; i < events.length; i++) {
    const start = new Date(Math.max(events[i].createdAt.getTime(), from.getTime()));
    const endRaw = i + 1 < events.length ? events[i + 1].createdAt : until;
    const end = new Date(Math.min(endRaw.getTime(), until.getTime()));
    if (end <= start) continue;
    const ms = workingMsBetween(start, end, cal);
    byStatus[events[i].toStatus] = (byStatus[events[i].toStatus] ?? 0) + ms / DAY_MS;
    totalMs += ms;
    if (paused.includes(events[i].toStatus)) pausedMs += ms;
  }
  return {
    calendarDays: calendarDaysBetween(from, until),
    workingDays: totalMs / DAY_MS,
    pausedWorkingDays: pausedMs / DAY_MS,
    activeWorkingDays: (totalMs - pausedMs) / DAY_MS,
    byStatus,
  };
}

export type SlaState = "ON_TRACK" | "AT_RISK" | "BREACHED" | "MET" | "NOT_APPLICABLE";

export interface SlaResult {
  state: SlaState;
  targetDays: number | null;
  usedDays: number;
  percentUsed: number | null;
}

/** AT_RISK at ≥ 80% of target; BREACHED above target; MET/BREACHED once completed. */
export function evaluateSla(usedDays: number, targetDays: number | null | undefined, completed: boolean): SlaResult {
  if (!targetDays || targetDays <= 0) return { state: "NOT_APPLICABLE", targetDays: null, usedDays, percentUsed: null };
  const pct = (usedDays / targetDays) * 100;
  let state: SlaState;
  if (completed) state = usedDays <= targetDays ? "MET" : "BREACHED";
  else if (usedDays > targetDays) state = "BREACHED";
  else if (pct >= 80) state = "AT_RISK";
  else state = "ON_TRACK";
  return { state, targetDays, usedDays, percentUsed: Math.round(pct) };
}
