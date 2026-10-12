import { z } from "zod";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ChatbotScope } from "@/lib/site-paths";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import { MAX_SNIPPET_LENGTH, normaliseOrigin, parseChatbotSnippet, SnippetError, type ChatbotScript } from "./chatbot-snippet";

/**
 * Administrator-managed third-party chatbot widget (Admin › Chatbot widget).
 * Restricted to `system.settings.manage` because embedding a script gives
 * that provider's code full access to the pages it runs on.
 */
export const CHATBOT_KEY = "integration.chatbot";

const stored = z.object({
  enabled: z.boolean().default(false),
  provider: z.string().default(""),
  snippet: z.string().default(""),
  scope: z.enum(["public", "public_and_app"]).default("public"),
  extraOrigins: z.array(z.string()).default([]),
  // Derived at save time
  scripts: z.array(z.object({ src: z.string().optional(), code: z.string().optional(), attrs: z.record(z.string(), z.string()) })).default([]),
  origins: z.array(z.string()).default([]),
});
export type StoredChatbot = z.infer<typeof stored>;
const DEFAULT: StoredChatbot = stored.parse({});

async function readStored(): Promise<StoredChatbot> {
  const row = await prisma.systemSetting.findUnique({ where: { key: CHATBOT_KEY } });
  if (!row) return DEFAULT;
  const parsed = stored.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT;
}

export async function getChatbotConfigView(actor: Actor) {
  assertCan(actor, "system.settings.manage");
  const row = await prisma.systemSetting.findUnique({ where: { key: CHATBOT_KEY }, select: { updatedAt: true } });
  return { ...(await readStored()), updatedAt: row?.updatedAt ?? null };
}

export interface ChatbotRuntime {
  enabled: boolean;
  scope: ChatbotScope;
  scripts: ChatbotScript[];
  origins: string[];
}

const OFF: ChatbotRuntime = { enabled: false, scope: "public", scripts: [], origins: [] };
let cache: { at: number; value: ChatbotRuntime } | null = null;
const TTL_MS = 15_000;

/**
 * What the proxy (CSP) and layouts need. Cached per server instance (the proxy
 * may run in a separate instance) for 15 seconds; failures fall back to "off" so the site never breaks.
 */
export async function getChatbotRuntime(): Promise<ChatbotRuntime> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = OFF;
  try {
    const c = await readStored();
    if (c.enabled && c.scripts.length) value = { enabled: true, scope: c.scope, scripts: c.scripts, origins: [...new Set([...c.origins, ...c.extraOrigins])] };
  } catch (err) {
    logger.error("chatbot.config_read_failed", { error: err as Error });
  }
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateChatbotCache() {
  cache = null;
}

export const chatbotInput = z.object({
  enabled: z.boolean(),
  provider: z.string().trim().max(100).default(""),
  snippet: z.string().max(MAX_SNIPPET_LENGTH).default(""),
  scope: z.enum(["public", "public_and_app"]).default("public"),
  extraOrigins: z.string().max(2000).default(""),
});

export async function saveChatbotConfig(actor: Actor, raw: unknown) {
  assertCan(actor, "system.settings.manage");
  const parsed = chatbotInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  const v = parsed.data;
  let scripts: ChatbotScript[] = [];
  let origins: string[] = [];
  const extraOrigins: string[] = [];
  try {
    if (v.snippet.trim()) ({ scripts, origins } = parseChatbotSnippet(v.snippet));
  } catch (e) {
    if (e instanceof SnippetError) throw new ValidationError(e.message, { snippet: [e.message] });
    throw e;
  }
  for (const line of v.extraOrigins.split(/[\s,]+/).filter(Boolean)) {
    try {
      extraOrigins.push(normaliseOrigin(line));
    } catch (e) {
      if (e instanceof SnippetError) throw new ValidationError(e.message, { extraOrigins: [e.message] });
      throw e;
    }
  }
  if (v.enabled && !scripts.length) throw new ValidationError("Paste the widget's embed code before enabling it.", { snippet: ["Required when the widget is enabled"] });
  const next: StoredChatbot = { enabled: v.enabled, provider: v.provider, snippet: v.snippet.trim(), scope: v.scope, extraOrigins: [...new Set(extraOrigins)], scripts, origins };
  await prisma.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key: CHATBOT_KEY } });
    await tx.systemSetting.upsert({
      where: { key: CHATBOT_KEY },
      create: { key: CHATBOT_KEY, value: next as never, description: "Third-party chatbot widget", updatedById: actor.id },
      update: { value: next as never, updatedById: actor.id },
    });
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: "settings.chatbot.update", entityType: "SystemSetting", entityId: CHATBOT_KEY,
      before: before?.value ?? null, after: next,
    });
  });
  invalidateChatbotCache();
}
