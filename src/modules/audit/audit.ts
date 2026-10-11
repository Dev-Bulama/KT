import { prisma, type Db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { getRequestContext } from "@/lib/request-context";

/**
 * Tamper-evident audit trail.
 *
 * - Records are append-only (enforced by a database trigger, see migration
 *   20261011163900_integrity_controls) and no application code path updates them.
 * - Each record stores the SHA-256 of its canonical content plus the previous
 *   record's hash, forming a hash chain. `verifyAuditChain` recomputes the chain
 *   to detect modification or deletion. This is an integrity check, not an
 *   immutability guarantee: a database superuser could still rewrite the chain.
 * - Never pass passwords, tokens or secrets in before/after.
 */

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const SENSITIVE = /pass(word)?|secret|token|hash|mfa/i;

function scrub(value: unknown): unknown {
  if (value === undefined) return null;
  const json = JSON.parse(JSON.stringify(value ?? null, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = SENSITIVE.test(k) ? "[REDACTED]" : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(json);
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function computeAuditHash(rec: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  correlationId: string | null;
  createdAt: Date;
  prevHash: string | null;
}): string {
  return sha256(
    canonical({
      actorId: rec.actorId,
      action: rec.action,
      entityType: rec.entityType,
      entityId: rec.entityId,
      before: rec.before ?? null,
      after: rec.after ?? null,
      reason: rec.reason,
      correlationId: rec.correlationId,
      createdAt: rec.createdAt.toISOString(),
      prevHash: rec.prevHash,
    }),
  );
}

const AUDIT_LOCK_KEY = 7310021; // arbitrary constant for pg_advisory_xact_lock

async function insert(db: Db, input: AuditInput) {
  const ctx = await getRequestContext();
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  const last = await db.auditEvent.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
  const createdAt = new Date();
  const before = input.before === undefined ? null : scrub(input.before);
  const after = input.after === undefined ? null : scrub(input.after);
  const rec = {
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before,
    after,
    reason: input.reason ?? null,
    correlationId: ctx.correlationId,
    createdAt,
    prevHash: last?.hash ?? null,
  };
  const hash = computeAuditHash(rec);
  await db.auditEvent.create({
    data: {
      ...rec,
      before: (before ?? undefined) as never,
      after: (after ?? undefined) as never,
      actorEmail: input.actorEmail ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      hash,
    },
  });
}

/**
 * Record an audit event. When `db` is a transaction client, the event commits
 * or rolls back with the business change. Otherwise a short transaction is used
 * so that the advisory lock serialises the hash chain.
 */
export async function audit(db: Db | null, input: AuditInput): Promise<void> {
  if (db && db !== prisma) {
    await insert(db, input);
    return;
  }
  await prisma.$transaction((tx) => insert(tx, input));
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstBrokenId: string | null;
  reason: string | null;
}

export async function verifyAuditChain(batch = 2000): Promise<ChainVerification> {
  let prevHash: string | null = null;
  let cursor: bigint | null = null;
  let checked = 0;
  for (;;) {
    const rows: Awaited<ReturnType<typeof prisma.auditEvent.findMany>> = await prisma.auditEvent.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: "asc" },
      take: batch,
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.prevHash !== prevHash) {
        return { ok: false, checked, firstBrokenId: r.id.toString(), reason: "Previous-hash link mismatch (record removed or reordered)" };
      }
      const expected = computeAuditHash({
        actorId: r.actorId, action: r.action, entityType: r.entityType, entityId: r.entityId,
        before: r.before, after: r.after, reason: r.reason, correlationId: r.correlationId,
        createdAt: r.createdAt, prevHash: r.prevHash,
      });
      if (expected !== r.hash) {
        return { ok: false, checked, firstBrokenId: r.id.toString(), reason: "Content hash mismatch (record modified)" };
      }
      prevHash = r.hash;
      checked++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { ok: true, checked, firstBrokenId: null, reason: null };
}
