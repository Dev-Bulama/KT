import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireActor } from "@/modules/auth/current";
import { getReport } from "@/modules/reports/periodic";
import { renderPdf } from "@/modules/reports/pdf";
import { periodicReportDoc, projectReportDoc } from "@/modules/reports/render";
import type { ProjectReportData } from "@/modules/reports/project-report";
import { audit } from "@/modules/audit/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    const rep = await getReport(actor, id);
    const doc = rep.type === "PROJECT_CLOSURE"
      ? projectReportDoc(rep.data as unknown as ProjectReportData, { version: rep.version, status: rep.status, summary: rep.summary })
      : periodicReportDoc(rep);
    const bytes = await renderPdf(doc);
    await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "report.exported_pdf", entityType: "ReportRecord", entityId: rep.id });
    return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${rep.title.replace(/[^\w.-]+/g, "_").slice(0, 80)}_v${rep.version}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
