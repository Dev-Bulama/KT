/**
 * Business calendar for SLA calculations (pure functions).
 * Days are evaluated in West Africa Time (UTC+1, no daylight saving).
 * A day counts fully when it is a configured working day and not a holiday.
 */

export interface BusinessCalendar {
  workingDays: number[]; // 0 = Sunday … 6 = Saturday
  holidays: string[]; // YYYY-MM-DD (local dates)
}

export const DEFAULT_CALENDAR: BusinessCalendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] };

const OFFSET_MS = 60 * 60 * 1000; // UTC+1
const DAY_MS = 24 * 60 * 60 * 1000;

function localDayStart(t: number): number {
  return Math.floor((t + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
}

function localDateKey(dayStart: number): string {
  return new Date(dayStart + OFFSET_MS).toISOString().slice(0, 10);
}

function localWeekday(dayStart: number): number {
  return new Date(dayStart + OFFSET_MS).getUTCDay();
}

export function isWorkingDay(dayStart: number, cal: BusinessCalendar): boolean {
  return cal.workingDays.includes(localWeekday(dayStart)) && !cal.holidays.includes(localDateKey(dayStart));
}

/** Milliseconds of [start, end) that fall on working days. */
export function workingMsBetween(start: Date, end: Date, cal: BusinessCalendar): number {
  let s = start.getTime();
  const e = end.getTime();
  if (e <= s) return 0;
  let total = 0;
  while (s < e) {
    const dayStart = localDayStart(s);
    const dayEnd = dayStart + DAY_MS;
    const segEnd = Math.min(dayEnd, e);
    if (isWorkingDay(dayStart, cal)) total += segEnd - s;
    s = segEnd;
  }
  return total;
}

export function workingDaysBetween(start: Date, end: Date, cal: BusinessCalendar): number {
  return workingMsBetween(start, end, cal) / DAY_MS;
}

export function calendarDaysBetween(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime()) / DAY_MS;
}

/** Adds N working days to a date (used for due dates such as acknowledgement deadlines). */
export function addWorkingDays(start: Date, days: number, cal: BusinessCalendar): Date {
  let remaining = days * DAY_MS;
  let t = start.getTime();
  let guard = 0;
  while (remaining > 0 && guard++ < 3660) {
    const dayStart = localDayStart(t);
    const dayEnd = dayStart + DAY_MS;
    if (isWorkingDay(dayStart, cal)) {
      const avail = dayEnd - t;
      if (avail >= remaining) return new Date(t + remaining);
      remaining -= avail;
    }
    t = dayEnd;
  }
  return new Date(t);
}
