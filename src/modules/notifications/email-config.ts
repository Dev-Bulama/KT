import { z } from "zod";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import { getEmailOverride, getEmailProvider, renderEmailHtml, SmtpEmailProvider, type EmailProvider, type SmtpOptions } from "./email";

/**
 * Admin-managed email delivery settings (Admin › Email delivery).
 *
 * mode "env"  → use the provider configured by environment variables (EMAIL_PROVIDER).
 * mode "smtp" → use the SMTP server entered by an administrator.
 *
 * The SMTP password is encrypted at rest (AES-256-GCM keyed from AUTH_SECRET),
 * is never returned to the browser, and is redacted from audit records.
 */
export const EMAIL_CONFIG_KEY = "integration.email";

const stored = z.object({
  mode: z.enum(["env", "smtp"]),
  host: z.string().default(""),
  port: z.number().int().default(587),
  security: z.enum(["tls", "starttls", "none"]).default("starttls"),
  username: z.string().default(""),
  passwordEnc: z.string().nullable().default(null),
  fromName: z.string().default(""),
  fromEmail: z.string().default(""),
  replyTo: z.string().default(""),
});
export type StoredEmailConfig = z.infer<typeof stored>;

const DEFAULT: StoredEmailConfig = stored.parse({ mode: "env" });

const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

export const emailConfigInput = z
  .object({
    mode: z.enum(["env", "smtp"]),
    host: z.string().trim().max(253).default(""),
    port: z.coerce.number().int().min(1, "Port must be 1–65535").max(65535, "Port must be 1–65535").default(587),
    security: z.enum(["tls", "starttls", "none"]).default("starttls"),
    username: z.string().trim().max(254).default(""),
    /** Blank keeps the stored password. */
    password: z.string().max(512).default(""),
    clearPassword: z.boolean().default(false),
    fromName: z.string().trim().max(120).regex(/^[^<>"\r\n]*$/, "Sender name cannot contain < > \" or line breaks").default(""),
    fromEmail: z.string().trim().max(254).default(""),
    replyTo: z.string().trim().max(254).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.mode !== "smtp") return;
    if (!v.host || !(HOST.test(v.host) || IPV4.test(v.host))) ctx.addIssue({ code: "custom", path: ["host"], message: "Enter a valid SMTP host name, e.g. smtp.example.gov.ng" });
    if (!z.email().safeParse(v.fromEmail).success) ctx.addIssue({ code: "custom", path: ["fromEmail"], message: "Enter a valid sender email address" });
    if (v.replyTo && !z.email().safeParse(v.replyTo).success) ctx.addIssue({ code: "custom", path: ["replyTo"], message: "Enter a valid reply-to address or leave blank" });
    if (v.security === "none" && process.env.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["security"], message: "Unencrypted SMTP is not permitted in production; choose TLS or STARTTLS." });
    }
  });

async function readStored(): Promise<StoredEmailConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: EMAIL_CONFIG_KEY } });
  if (!row) return DEFAULT;
  const parsed = stored.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT;
}

/** Safe view for the admin page: never includes the password. */
export async function getEmailConfigView(actor: Actor) {
  assertCan(actor, "system.notifications.manage");
  const c = await readStored();
  const row = await prisma.systemSetting.findUnique({ where: { key: EMAIL_CONFIG_KEY }, select: { updatedAt: true } });
  return {
    mode: c.mode,
    host: c.host,
    port: c.port,
    security: c.security,
    username: c.username,
    hasPassword: Boolean(c.passwordEnc),
    fromName: c.fromName,
    fromEmail: c.fromEmail,
    replyTo: c.replyTo,
    updatedAt: row?.updatedAt ?? null,
    envProvider: process.env.EMAIL_PROVIDER ?? "console",
  };
}

function formatFrom(name: string, email: string) {
  return name ? `"${name.replace(/"/g, "")}" <${email}>` : email;
}

function smtpOptions(c: StoredEmailConfig): SmtpOptions {
  let password: string | null = null;
  if (c.passwordEnc) {
    try {
      password = decrypt(c.passwordEnc);
    } catch {
      // AUTH_SECRET changed since the password was saved.
      throw new Error("Stored SMTP password cannot be decrypted (was AUTH_SECRET rotated?). Re-enter it in Admin › Email delivery.");
    }
  }
  return { host: c.host, port: c.port, security: c.security, username: c.username || null, password, from: formatFrom(c.fromName, c.fromEmail), replyTo: c.replyTo || null };
}

// Short per-instance cache so the outbox job does not read settings for every email.
let cache: { at: number; provider: EmailProvider } | null = null;
const TTL_MS = 30_000;

export function invalidateEmailProviderCache() {
  if (cache?.provider instanceof SmtpEmailProvider) cache.provider.close();
  cache = null;
}

/** The provider used for delivery: test override → admin SMTP settings → environment configuration. */
export async function resolveEmailProvider(): Promise<EmailProvider> {
  const o = getEmailOverride();
  if (o) return o;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.provider;
  const c = await readStored();
  const provider = c.mode === "smtp" && c.host ? new SmtpEmailProvider(smtpOptions(c)) : getEmailProvider();
  if (cache?.provider instanceof SmtpEmailProvider && cache.provider !== provider) cache.provider.close();
  cache = { at: Date.now(), provider };
  return provider;
}

export async function saveEmailConfig(actor: Actor, raw: unknown) {
  assertCan(actor, "system.notifications.manage");
  const parsed = emailConfigInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  const v = parsed.data;
  const before = await readStored();
  let passwordEnc = before.passwordEnc;
  if (v.clearPassword) passwordEnc = null;
  else if (v.password) passwordEnc = encrypt(v.password);
  const next: StoredEmailConfig = {
    mode: v.mode, host: v.host, port: v.port, security: v.security, username: v.username,
    passwordEnc, fromName: v.fromName, fromEmail: v.fromEmail, replyTo: v.replyTo,
  };
  const redact = (c: StoredEmailConfig) => ({ ...c, passwordEnc: undefined, passwordSet: Boolean(c.passwordEnc) });
  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: EMAIL_CONFIG_KEY },
      create: { key: EMAIL_CONFIG_KEY, value: next as never, description: "Email delivery (SMTP) settings", updatedById: actor.id },
      update: { value: next as never, updatedById: actor.id },
    });
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: "settings.email.update", entityType: "SystemSetting", entityId: EMAIL_CONFIG_KEY,
      before: redact(before), after: redact(next),
    });
  });
  invalidateEmailProviderCache();
}

/**
 * Sends a test email immediately (bypassing the outbox) using the active
 * configuration, so an administrator sees the provider's error message directly.
 */
export async function sendTestEmail(actor: Actor, to: string): Promise<{ provider: string }> {
  assertCan(actor, "system.notifications.manage");
  if (!z.email().safeParse(to).success) throw new ValidationError("Enter a valid recipient address.", { to: ["Enter a valid email address"] });
  invalidateEmailProviderCache();
  const provider = await resolveEmailProvider();
  const body = `This is a test message from the KATDICT platform, sent by ${actor.name} to confirm that email delivery (${provider.name}) is working.`;
  try {
    if (provider instanceof SmtpEmailProvider) await provider.verify();
    await provider.send({ to, subject: "KATDICT SPIMP test email", text: body, html: renderEmailHtml("Test email", body) });
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    logger.warn("email.test_failed", { provider: provider.name, error: message });
    await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "settings.email.test", entityType: "SystemSetting", entityId: EMAIL_CONFIG_KEY, after: { to, provider: provider.name, ok: false } });
    throw new ValidationError(`Test email failed (${provider.name}): ${message}`);
  }
  await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "settings.email.test", entityType: "SystemSetting", entityId: EMAIL_CONFIG_KEY, after: { to, provider: provider.name, ok: true } });
  return { provider: provider.name };
}
