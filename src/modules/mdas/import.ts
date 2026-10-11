import { prisma } from "@/lib/db";
import { parseCsv } from "@/lib/csv";
import { audit } from "@/modules/audit/audit";
import type { Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import { MDA_CSV_COLUMNS, mdaCsvRowSchema, type MdaCsvRow } from "./schemas";

export interface ImportRowResult {
  line: number;
  name: string;
  abbreviation: string;
  action: "create" | "update" | "skip" | "error";
  errors: string[];
}

export interface ImportPlan {
  rows: ImportRowResult[];
  valid: (MdaCsvRow & { line: number; action: "create" | "update" })[];
  errorCount: number;
  headerErrors: string[];
}

/**
 * Two-phase controlled import of the VERIFIED official MDA directory.
 * Phase 1 (`planMdaImport`) validates every row (types, required fields,
 * duplicates within the file and against the database) without writing.
 * Phase 2 (`applyMdaImport`) applies only if the plan has zero errors, in a
 * single transaction.
 */
export async function planMdaImport(csvText: string): Promise<ImportPlan> {
  const table = parseCsv(csvText);
  const headerErrors: string[] = [];
  if (table.length === 0) return { rows: [], valid: [], errorCount: 1, headerErrors: ["The file is empty."] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  for (const col of ["name", "abbreviation", "category"]) {
    if (!header.includes(col)) headerErrors.push(`Missing required column: ${col}`);
  }
  const unknown = header.filter((h) => !(MDA_CSV_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) headerErrors.push(`Unknown columns: ${unknown.join(", ")}`);
  if (headerErrors.length) return { rows: [], valid: [], errorCount: headerErrors.length, headerErrors };
  if (table.length - 1 > 2000) return { rows: [], valid: [], errorCount: 1, headerErrors: ["Too many rows (max 2000)."] };

  const existing = await prisma.mda.findMany({ select: { id: true, name: true, abbreviation: true, status: true } });
  const byName = new Map(existing.map((m) => [m.name.toLowerCase(), m]));
  const byAbbr = new Map(existing.map((m) => [m.abbreviation.toUpperCase(), m]));
  const seenNames = new Set<string>();
  const seenAbbr = new Set<string>();
  const fileAbbrs = new Set(
    table.slice(1).map((r) => (r[header.indexOf("abbreviation")] ?? "").trim().toUpperCase()).filter(Boolean),
  );

  const rows: ImportRowResult[] = [];
  const valid: ImportPlan["valid"] = [];
  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const obj: Record<string, string> = {};
    header.forEach((h, i) => (obj[h] = (cells[i] ?? "").trim()));
    const parsed = mdaCsvRowSchema.safeParse(obj);
    const errors: string[] = [];
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
      rows.push({ line, name: obj.name ?? "", abbreviation: obj.abbreviation ?? "", action: "error", errors });
      return;
    }
    const r = parsed.data;
    const nameKey = r.name.toLowerCase();
    if (seenNames.has(nameKey)) errors.push("Duplicate name within file");
    if (seenAbbr.has(r.abbreviation)) errors.push("Duplicate abbreviation within file");
    seenNames.add(nameKey);
    seenAbbr.add(r.abbreviation);
    if (r.supervising_ministry_abbreviation && !byAbbr.has(r.supervising_ministry_abbreviation) && !fileAbbrs.has(r.supervising_ministry_abbreviation)) {
      errors.push(`Unknown supervising ministry: ${r.supervising_ministry_abbreviation}`);
    }
    const matchName = byName.get(nameKey);
    const matchAbbr = byAbbr.get(r.abbreviation);
    if (matchName && matchAbbr && matchName.id !== matchAbbr.id) errors.push("Name and abbreviation match two different existing MDAs");
    const target = matchName ?? matchAbbr;
    if (errors.length) {
      rows.push({ line, name: r.name, abbreviation: r.abbreviation, action: "error", errors });
      return;
    }
    const action = target ? "update" : "create";
    rows.push({ line, name: r.name, abbreviation: r.abbreviation, action, errors: [] });
    valid.push({ ...r, line, action });
  });
  const errorCount = rows.filter((r) => r.action === "error").length;
  return { rows, valid, errorCount, headerErrors };
}

export async function applyMdaImport(actor: Actor, csvText: string) {
  assertCan(actor, "mda.import");
  const plan = await planMdaImport(csvText);
  if (plan.errorCount > 0) return { applied: false as const, plan };
  await prisma.$transaction(
    async (tx) => {
      // Pass 1: upsert MDAs without supervision links.
      for (const r of plan.valid) {
        const data = {
          name: r.name,
          abbreviation: r.abbreviation,
          category: r.category,
          address: r.address ?? null,
          officialEmail: r.official_email ?? null,
          officialPhone: r.official_phone ?? null,
          contactPersonName: r.contact_person ?? null,
          contactPersonDesignation: r.contact_designation ?? null,
          ictContactName: r.ict_contact_name ?? null,
          ictContactEmail: r.ict_contact_email ?? null,
          ictContactPhone: r.ict_contact_phone ?? null,
          website: r.website ?? null,
          isDirectoryVerified: true,
        };
        const existing = await tx.mda.findFirst({ where: { OR: [{ name: { equals: r.name, mode: "insensitive" } }, { abbreviation: r.abbreviation }] } });
        if (existing) {
          // Never overwrite profile data an active MDA maintains itself; only mark as verified.
          const locked = ["ACTIVE", "APPROVED", "SUSPENDED"].includes(existing.status);
          await tx.mda.update({ where: { id: existing.id }, data: locked ? { isDirectoryVerified: true } : data });
        } else {
          await tx.mda.create({ data: { ...data, status: "DIRECTORY" } });
        }
      }
      // Pass 2: supervision links.
      for (const r of plan.valid) {
        if (!r.supervising_ministry_abbreviation) continue;
        const parent = await tx.mda.findUnique({ where: { abbreviation: r.supervising_ministry_abbreviation } });
        if (parent) await tx.mda.update({ where: { abbreviation: r.abbreviation }, data: { supervisingMinistryId: parent.id } });
      }
      await audit(tx, {
        actorId: actor.id, actorEmail: actor.email, action: "mda.directory_import", entityType: "Mda",
        after: { created: plan.valid.filter((v) => v.action === "create").length, updated: plan.valid.filter((v) => v.action === "update").length },
      });
    },
    { timeout: 60_000 },
  );
  return { applied: true as const, plan };
}
