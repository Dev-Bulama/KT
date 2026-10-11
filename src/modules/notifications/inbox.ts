import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/rbac/actor";
import { NOTIFICATION_TYPES } from "./types";

export async function listNotifications(actor: Actor, opts: { unreadOnly?: boolean; page?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const where = { userId: actor.id, ...(opts.unreadOnly ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);
  return { items, total, unread, page };
}

export async function unreadCount(actor: Actor) {
  return prisma.notification.count({ where: { userId: actor.id, readAt: null } });
}

export async function markRead(actor: Actor, ids: string[] | "all") {
  await prisma.notification.updateMany({ where: { userId: actor.id, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) }, data: { readAt: new Date() } });
}

export async function getPreferences(actor: Actor) {
  const prefs = await prisma.notificationPreference.findMany({ where: { userId: actor.id } });
  return Object.entries(NOTIFICATION_TYPES).map(([type, meta]) => {
    const p = prefs.find((x) => x.type === type);
    return { type, label: meta.label, mandatory: meta.mandatory, email: meta.mandatory || (p?.emailEnabled ?? true), inApp: meta.mandatory || (p?.inAppEnabled ?? true) };
  });
}

export async function savePreferences(actor: Actor, prefs: { type: string; email: boolean; inApp: boolean }[]) {
  for (const p of prefs) {
    const meta = NOTIFICATION_TYPES[p.type as keyof typeof NOTIFICATION_TYPES];
    if (!meta || meta.mandatory) continue; // mandatory notifications cannot be suppressed
    await prisma.notificationPreference.upsert({
      where: { userId_type: { userId: actor.id, type: p.type } },
      create: { userId: actor.id, type: p.type, emailEnabled: p.email, inAppEnabled: p.inApp },
      update: { emailEnabled: p.email, inAppEnabled: p.inApp },
    });
  }
}
