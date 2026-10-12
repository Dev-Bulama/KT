import { cache } from "react";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sha256 } from "@/lib/crypto";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import { SECTIONS, sniffLogo, type SectionContent, type SectionKey } from "./content-schema";

export { contentFromForm } from "./content-schema";

const readAll = cache(async () => {
  try {
    const rows = await prisma.siteContent.findMany();
    return new Map(rows.map((r) => [r.key, r]));
  } catch (err) {
    // The public site must render even if the database is briefly unavailable.
    logger.error("site.content_read_failed", { error: err as Error });
    return new Map();
  }
});

/**
 * Content for a public page section: the saved version, or the shipped default.
 * Callers render dynamically (the public layout calls `connection()`), so edits appear immediately.
 */
export async function getSiteContent<K extends SectionKey>(key: K): Promise<SectionContent<K>> {
  const row = (await readAll()).get(key);
  const def = SECTIONS[key];
  if (row) {
    const parsed = def.schema.safeParse(row.value);
    if (parsed.success) return parsed.data as SectionContent<K>;
  }
  return def.defaults as SectionContent<K>;
}

export async function getSiteContentStatus() {
  const rows = await prisma.siteContent.findMany({ select: { key: true, updatedAt: true } });
  return new Map(rows.map((r) => [r.key, r.updatedAt]));
}

export async function saveSiteContent(actor: Actor, key: SectionKey, raw: unknown) {
  assertCan(actor, "site.content.manage");
  const def = SECTIONS[key];
  const parsed = (def.schema as z.ZodType).safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      (fieldErrors[path] ??= []).push(issue.message);
      const top = String(issue.path[0] ?? "");
      if (top && top !== path) (fieldErrors[top] ??= []).push(`${issue.path.slice(1).join(" ")}: ${issue.message}`);
    }
    throw new ValidationError("Please correct the highlighted fields.", fieldErrors);
  }
  await prisma.$transaction(async (tx) => {
    const before = await tx.siteContent.findUnique({ where: { key } });
    await tx.siteContent.upsert({
      where: { key },
      create: { key, value: parsed.data as never, updatedById: actor.id },
      update: { value: parsed.data as never, updatedById: actor.id },
    });
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: "site.content.update", entityType: "SiteContent", entityId: key,
      before: before?.value ?? def.defaults, after: parsed.data,
    });
  });
}

export async function resetSiteContent(actor: Actor, key: SectionKey) {
  assertCan(actor, "site.content.manage");
  await prisma.$transaction(async (tx) => {
    const before = await tx.siteContent.findUnique({ where: { key } });
    if (!before) return;
    await tx.siteContent.delete({ where: { key } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "site.content.reset", entityType: "SiteContent", entityId: key, before: before.value, after: SECTIONS[key].defaults });
  });
}

// ---- Logo ---------------------------------------------------------------

export const LOGO_KEY = "logo";
export const LOGO_MAX_BYTES = 1024 * 1024;

export const getLogoMeta = cache(async (): Promise<{ version: string; updatedAt: Date } | null> => {
  try {
    const row = await prisma.siteAsset.findUnique({ where: { key: LOGO_KEY }, select: { sha256: true, updatedAt: true } });
    return row ? { version: row.sha256.slice(0, 16), updatedAt: row.updatedAt } : null;
  } catch (err) {
    logger.error("site.logo_read_failed", { error: err as Error });
    return null;
  }
});

export async function getLogoAsset() {
  return prisma.siteAsset.findUnique({ where: { key: LOGO_KEY } });
}

export async function uploadLogo(actor: Actor, file: File | null) {
  assertCan(actor, "site.content.manage");
  if (!file || file.size === 0) throw new ValidationError("Choose an image file to upload.", { logo: ["Choose a PNG, JPEG or WebP image"] });
  if (file.size > LOGO_MAX_BYTES) throw new ValidationError("The logo must be 1 MB or smaller.", { logo: ["Maximum size is 1 MB"] });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffLogo(bytes);
  if (!mime) throw new ValidationError("Only PNG, JPEG or WebP images are accepted (SVG is not supported for security reasons).", { logo: ["Unsupported file type"] });
  const hash = sha256(Buffer.from(bytes));
  await prisma.$transaction(async (tx) => {
    const before = await tx.siteAsset.findUnique({ where: { key: LOGO_KEY }, select: { sha256: true, mime: true, sizeBytes: true } });
    const data = { mime, bytes: Buffer.from(bytes), sizeBytes: bytes.length, sha256: hash, updatedById: actor.id };
    await tx.siteAsset.upsert({ where: { key: LOGO_KEY }, create: { key: LOGO_KEY, ...data }, update: data });
    await audit(tx, {
      actorId: actor.id, actorEmail: actor.email, action: "site.logo.upload", entityType: "SiteAsset", entityId: LOGO_KEY,
      before: before ? { digest: before.sha256, mime: before.mime, sizeBytes: before.sizeBytes } : null,
      after: { digest: hash, mime, sizeBytes: bytes.length, originalName: file.name.slice(0, 150) },
    });
  });
}

export async function removeLogo(actor: Actor) {
  assertCan(actor, "site.content.manage");
  await prisma.$transaction(async (tx) => {
    const before = await tx.siteAsset.findUnique({ where: { key: LOGO_KEY }, select: { sha256: true, mime: true, sizeBytes: true } });
    if (!before) return;
    await tx.siteAsset.delete({ where: { key: LOGO_KEY } });
    await audit(tx, { actorId: actor.id, actorEmail: actor.email, action: "site.logo.remove", entityType: "SiteAsset", entityId: LOGO_KEY, before: { digest: before.sha256, mime: before.mime, sizeBytes: before.sizeBytes } });
  });
}
