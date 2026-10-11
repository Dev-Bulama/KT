import { getSetting } from "@/modules/settings/service";
import type { BusinessCalendar } from "./calendar";

export async function loadCalendar(): Promise<BusinessCalendar> {
  const [workingDays, holidays] = await Promise.all([getSetting("calendar.workingDays"), getSetting("calendar.holidays")]);
  return { workingDays, holidays };
}
