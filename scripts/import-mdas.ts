/**
 * Controlled import of the VERIFIED official MDA directory.
 *
 *   npm run mda:import -- path/to/verified-mdas.csv               # dry run: validate and print plan
 *   npm run mda:import -- path/to/verified-mdas.csv --apply --actor admin@example.gov.ng
 *
 * The same validation runs in the web UI (Admin › MDA directory › Import).
 * Required columns: name, abbreviation, category. See docs/MDA_IMPORT.md.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { applyMdaImport, planMdaImport } from "../src/modules/mdas/import";
import { loadActor } from "../src/modules/rbac/actor";

async function main() {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) throw new Error("Usage: npm run mda:import -- <file.csv> [--apply --actor <email>]");
  const csv = await readFile(file, "utf8");
  const plan = await planMdaImport(csv);
  for (const e of plan.headerErrors) console.error(`HEADER: ${e}`);
  for (const r of plan.rows) console.log(`${String(r.line).padStart(5)}  ${r.action.padEnd(6)}  ${r.abbreviation.padEnd(12)}  ${r.name}${r.errors.length ? `  !! ${r.errors.join("; ")}` : ""}`);
  console.log(`\n${plan.valid.filter((v) => v.action === "create").length} to create, ${plan.valid.filter((v) => v.action === "update").length} to update, ${plan.errorCount} error(s).`);
  if (!rest.includes("--apply")) {
    console.log("Dry run only. Re-run with --apply --actor <email> to import.");
    return;
  }
  const email = rest[rest.indexOf("--actor") + 1];
  const user = email ? await prisma.user.findUnique({ where: { email: email.toLowerCase() } }) : null;
  if (!user) throw new Error("--actor must be the email of an active user holding mda.import");
  const actor = await loadActor(prisma, user.id, null);
  if (!actor) throw new Error("Actor is not active.");
  const res = await applyMdaImport(actor, csv);
  if (!res.applied) {
    console.error("Import NOT applied: fix the errors above first.");
    process.exitCode = 2;
  } else console.log("Import applied in a single transaction and audited.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
