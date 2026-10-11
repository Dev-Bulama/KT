import { apiError, csvResponse } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { requireActor } from "@/modules/auth/current";
import { getReport } from "@/modules/reports/periodic";
import { audit } from "@/modules/audit/audit";

/** Flattens a report snapshot to Section,Field,Value rows (formula-injection safe). */
function flatten(prefix: string, v: unknown, out: unknown[][]) {
  if (v === null || v === undefined) out.push([prefix, ""]);
  else if (Array.isArray(v)) v.forEach((x, i) => flatten(`${prefix}[${i + 1}]`, x, out));
  else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(prefix ? `${prefix}.${k}` : k, x, out);
  else out.push([prefix, v]);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    const rep = await getReport(actor, id);
    const rows: unknown[][] = [];
    flatten("", rep.data, rows);
    await audit(null, { actorId: actor.id, actorEmail: actor.email, action: "report.exported_csv", entityType: "ReportRecord", entityId: rep.id });
    return csvResponse(toCsv(["Field", "Value"], rows), `${rep.title.replace(/[^\w.-]+/g, "_").slice(0, 80)}_v${rep.version}.csv`);
  } catch (e) {
    return apiError(e);
  }
}
