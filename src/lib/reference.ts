import type { Db } from "@/lib/db";

/**
 * Allocates a human-readable reference such as KATDICT-REQ-2026-00001.
 * Uses an atomic UPSERT on a per-type/per-year counter row; the row lock is
 * held until the surrounding transaction commits, so references are unique
 * and gap-free for committed transactions. Never derived from timestamps.
 */
export async function nextReference(db: Db, kind: "REQ" | "PRJ" | "CMP", year = new Date().getFullYear()): Promise<string> {
  const key = `${kind}-${year}`;
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  const n = Number(rows[0].value);
  return `KATDICT-${kind}-${year}-${String(n).padStart(5, "0")}`;
}
