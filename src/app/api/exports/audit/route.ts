import { apiError, csvResponse } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { requireActor } from "@/modules/auth/current";
import { assertCan } from "@/modules/rbac/authorize";
import { audit } from "@/modules/audit/audit";

export async function GET(req: Request) {
  try {
    const actor = await requireActor();
    assertCan(actor, "audit.read");
    const sp = new URL(req.url).searchParams;
    const rows = await prisma.auditEvent.findMany({
      where: {
        AND: [sp.get("action") ? { action: { startsWith: sp.get("action")! } } : {}, sp.get("entityType") ? { entityType: sp.get("entityType")! } : {}, sp.get("entityId") ? { entityId: sp.get("entityId")! } : {},
          sp.get("from") ? { createdAt: { gte: new Date(sp.get("from")!) } } : {}, sp.get("to") ? { createdAt: { lte: new Date(`${sp.get("to")}T23:59:59Z`) } } : {}],
      },
      orderBy: { id: "asc" }, take: 50000,
    });
    await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "export.audit", entityType: "AuditEvent", after: { rows: rows.length, filters: Object.fromEntries(sp) } });
    return csvResponse(toCsv(["id", "createdAt", "actorId", "actorEmail", "action", "entityType", "entityId", "before", "after", "reason", "correlationId", "ip", "prevHash", "hash"],
      rows.map((r) => [r.id.toString(), r.createdAt.toISOString(), r.actorId, r.actorEmail, r.action, r.entityType, r.entityId, JSON.stringify(r.before), JSON.stringify(r.after), r.reason, r.correlationId, r.ip, r.prevHash, r.hash])),
      `katdict-audit-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (e) {
    return apiError(e);
  }
}
