"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { requireActor } from "@/modules/auth/current";
import { saveKnowledgeDoc, setKnowledgeStatus } from "@/modules/knowledge/service";

const FIELDS = ["title", "summary", "body", "category", "tags", "visibility", "mdaId", "projectId"];

export async function saveKnowledgeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string | null = null;
  const res = await runAction(async () => {
    const doc = await saveKnowledgeDoc(await requireActor(), str(fd, "id") || null, Object.fromEntries(FIELDS.map((k) => [k, str(fd, k) ?? ""])));
    id = doc.id;
  });
  if (res.ok && id) redirect(`/knowledge/${id}`);
  return res;
}

export async function knowledgeStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id")!;
  const res = await runAction(async () => { await setKnowledgeStatus(await requireActor(), id, str(fd, "status") as "PUBLISHED"); return "Status updated."; });
  revalidatePath(`/knowledge/${id}`);
  return res;
}
