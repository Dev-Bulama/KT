"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { requireActor } from "@/modules/auth/current";
import { markRead, savePreferences } from "@/modules/notifications/inbox";
import { NOTIFICATION_TYPES } from "@/modules/notifications/types";

export async function markAllReadAction(): Promise<ActionState> {
  const res = await runAction(async () => { await markRead(await requireActor(), "all"); return "All notifications marked as read."; });
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  return res;
}

export async function preferencesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const prefs = Object.keys(NOTIFICATION_TYPES).map((type) => ({ type, email: fd.get(`email:${type}`) === "on", inApp: fd.get(`app:${type}`) === "on" }));
    await savePreferences(await requireActor(), prefs);
    return "Preferences saved. Mandatory security and administrative notifications are always delivered.";
  });
}
