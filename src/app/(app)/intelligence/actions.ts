"use server";

import { runAction, type ActionState } from "@/lib/action";
import { requireActor } from "@/modules/auth/current";
import { executiveBriefing } from "@/modules/ai/features";

export async function briefingAction(): Promise<ActionState> {
  return runAction(async () => {
    const r = await executiveBriefing(await requireActor());
    return { message: r.notice ?? "Briefing generated.", data: { briefing: r as unknown as Record<string, unknown> } };
  });
}
