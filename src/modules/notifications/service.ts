import { prisma, type Db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getEmailProvider, renderEmailHtml } from "./email";
import { NOTIFICATION_TYPES, type NotificationType } from "./types";

export interface NotifyInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  /** Send email in addition to in-app (subject to preferences). Default true. */
  email?: boolean;
  dedupeKey?: string;
}

/**
 * Persist notification intent inside the caller's transaction:
 * in-app rows + outbox email events. Emails are never sent inside the
 * transaction; `processOutbox` delivers them with retries.
 */
export async function notify(db: Db, input: NotifyInput): Promise<void> {
  const ids = [...new Set(input.userIds.filter(Boolean))];
  if (!ids.length) return;
  const mandatory = NOTIFICATION_TYPES[input.type].mandatory;
  const users = await db.user.findMany({
    where: { id: { in: ids }, status: { in: ["ACTIVE", "PENDING_VERIFICATION"] } },
    select: { id: true, email: true, name: true, notificationPrefs: { where: { type: input.type } } },
  });
  for (const u of users) {
    const pref = u.notificationPrefs[0];
    const inApp = mandatory || !pref || pref.inAppEnabled;
    const email = (input.email ?? true) && (mandatory || !pref || pref.emailEnabled);
    if (input.dedupeKey) {
      const seen = await db.notification.findUnique({ where: { userId_dedupeKey: { userId: u.id, dedupeKey: input.dedupeKey } } });
      if (seen) continue; // already notified for this event
    }
    if (inApp || input.dedupeKey) {
      // With a dedupe key the row is always written (hidden if in-app is disabled) so repeats are suppressed.
      await db.notification.create({
        data: { userId: u.id, type: input.type, title: input.title, body: input.body, link: input.link ?? null, mandatory, dedupeKey: input.dedupeKey ?? null, readAt: inApp ? null : new Date() },
      });
    }
    if (email) {
      await enqueueEmail(db, {
        to: u.email,
        subject: `[KATDICT] ${input.title}`,
        text: `Dear ${u.name},\n\n${input.body}${input.link ? `\n\nOpen: ${(process.env.APP_URL ?? "") + input.link}` : ""}\n\nKatsina State Directorate of ICT`,
        html: renderEmailHtml(input.title, `Dear ${u.name},\n\n${input.body}`, input.link),
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${u.id}` : undefined,
      });
    }
  }
}

export async function enqueueEmail(
  db: Db,
  msg: { to: string; subject: string; text: string; html?: string; dedupeKey?: string },
): Promise<void> {
  const { dedupeKey, ...payload } = msg;
  if (dedupeKey) {
    const exists = await db.outboxEvent.findUnique({ where: { dedupeKey } });
    if (exists) return;
  }
  await db.outboxEvent.create({ data: { kind: "email", payload, dedupeKey: dedupeKey ?? null } });
}

function backoffMs(attempt: number) {
  return Math.min(60 * 60_000, 30_000 * 2 ** attempt); // 30s, 1m, 2m … capped at 1h
}

/**
 * Deliver pending outbox events. Claims rows with FOR UPDATE SKIP LOCKED so
 * concurrent cron invocations never double-send. Safe to call repeatedly.
 */
export async function processOutbox(limit = 25): Promise<{ sent: number; failed: number }> {
  // Release stale claims (e.g. function timed out mid-delivery).
  await prisma.outboxEvent.updateMany({
    where: { status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: "FAILED", lockedAt: null, lastError: "Delivery attempt timed out" },
  });
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "OutboxEvent" SET status = 'PROCESSING', "lockedAt" = now()
    WHERE id IN (
      SELECT id FROM "OutboxEvent"
      WHERE status IN ('PENDING','FAILED') AND "nextAttemptAt" <= now()
      ORDER BY "createdAt" LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) RETURNING id`;
  let sent = 0;
  let failed = 0;
  for (const { id } of claimed) {
    const ev = await prisma.outboxEvent.findUnique({ where: { id } });
    if (!ev) continue;
    try {
      if (ev.kind === "email") {
        const p = ev.payload as { to: string; subject: string; text: string; html?: string };
        await getEmailProvider().send(p);
      }
      await prisma.outboxEvent.update({ where: { id }, data: { status: "SENT", processedAt: new Date(), lockedAt: null, attempts: { increment: 1 } } });
      sent++;
    } catch (err) {
      const attempts = ev.attempts + 1;
      const dead = attempts >= ev.maxAttempts;
      await prisma.outboxEvent.update({
        where: { id },
        data: {
          status: dead ? "DEAD" : "FAILED",
          attempts,
          lockedAt: null,
          lastError: (err as Error).message.slice(0, 1000),
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        },
      });
      logger.error("outbox.delivery_failed", { id, attempts, dead, error: (err as Error).message });
      failed++;
    }
  }
  return { sent, failed };
}

/** Admin retry path for dead/failed events. */
export async function retryOutboxEvent(id: string) {
  await prisma.outboxEvent.update({ where: { id }, data: { status: "PENDING", nextAttemptAt: new Date(), attempts: 0, lastError: null } });
}

// ---- Recipient helpers ---------------------------------------------------

export async function usersWithPermission(db: Db, permission: string, opts?: { departmentId?: string | null }): Promise<string[]> {
  const users = await db.user.findMany({
    where: {
      status: "ACTIVE",
      userType: "KATDICT_STAFF",
      roles: { some: { role: { permissions: { some: { permission: { key: permission } } } } } },
      ...(opts?.departmentId ? { OR: [{ departmentId: opts.departmentId }, { headOfDepartments: { some: { id: opts.departmentId } } }] } : {}),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function mdaAdminIds(db: Db, mdaId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { status: "ACTIVE", membership: { mdaId }, roles: { some: { role: { key: "MDA_ADMIN" } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function departmentHeadId(db: Db, departmentId: string | null | undefined): Promise<string | null> {
  if (!departmentId) return null;
  const d = await db.department.findUnique({ where: { id: departmentId }, select: { headId: true } });
  return d?.headId ?? null;
}
