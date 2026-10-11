import { apiError, csvResponse } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { requireActor } from "@/modules/auth/current";
import { assertCan } from "@/modules/rbac/authorize";
import { requestScope } from "@/modules/rbac/scope";
import { audit } from "@/modules/audit/audit";

/** Scoped CSV export (formula-injection safe). */
export async function GET(req: Request) {
  try {
    const actor = await requireActor();
    assertCan(actor, "report.export");
    const sp = new URL(req.url).searchParams;
    const rows = await prisma.serviceRequest.findMany({
      where: {
        AND: [requestScope(actor), { status: { not: "DRAFT" } },
          sp.get("status") ? { status: sp.get("status") as never } : {}, sp.get("mdaId") ? { mdaId: sp.get("mdaId")! } : {},
          sp.get("categoryId") ? { service: { categoryId: sp.get("categoryId")! } } : {}, sp.get("q") ? { title: { contains: sp.get("q")!, mode: "insensitive" } } : {}],
      },
      orderBy: { submittedAt: "desc" }, take: 10000,
      select: { reference: true, title: true, status: true, priority: true, urgency: true, submittedAt: true, decidedAt: true, mda: { select: { name: true } }, service: { select: { name: true, category: { select: { name: true } } } }, assignedDepartment: { select: { name: true } } },
    });
    await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "export.requests", entityType: "ServiceRequest", after: { rows: rows.length } });
    return csvResponse(
      toCsv(["Reference", "Title", "MDA", "Category", "Service", "Status", "Priority", "Urgency", "Department", "Submitted", "Decided"],
        rows.map((r) => [r.reference, r.title, r.mda.name, r.service.category.name, r.service.name, r.status, r.priority, r.urgency, r.assignedDepartment?.name, r.submittedAt?.toISOString(), r.decidedAt?.toISOString()])),
      `katdict-requests-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  } catch (e) {
    return apiError(e);
  }
}
