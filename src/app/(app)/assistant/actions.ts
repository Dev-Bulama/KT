"use server";

import { runAction, str, type ActionState } from "@/lib/action";
import { requireActor } from "@/modules/auth/current";
import { askAnalytics, askAssistant } from "@/modules/ai/features";

export async function assistantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const r = await askAssistant(await requireActor(), str(fd, "question") ?? "");
    return { message: r.notice ?? "", data: { answer: r as unknown as Record<string, unknown> } };
  });
}

export async function analyticsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const r = await askAnalytics(await requireActor(), str(fd, "question") ?? "");
    return { message: r.notice ?? "", data: { analytics: r as unknown as Record<string, unknown> } };
  });
}
