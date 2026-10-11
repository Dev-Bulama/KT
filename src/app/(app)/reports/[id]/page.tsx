import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { getReport } from "@/modules/reports/periodic";
import { periodicReportDoc, projectReportDoc } from "@/modules/reports/render";
import type { ProjectReportData } from "@/modules/reports/project-report";
import { NotFoundError } from "@/lib/errors";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { Field, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDateTime } from "@/lib/utils";
import { draftSummaryAction, finalizeReportAction } from "../actions";

export const metadata = { title: "Report" };

export default async function ReportView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePageActor();
  let rep: Awaited<ReturnType<typeof getReport>>;
  try {
    rep = await getReport(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const doc = rep.type === "PROJECT_CLOSURE" ? projectReportDoc(rep.data as unknown as ProjectReportData, { version: rep.version, status: rep.status, summary: rep.summary }) : periodicReportDoc(rep);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: rep.title }]} title={rep.title}
        description={<>Version {rep.version} · generated {formatDateTime(rep.generatedAt)} by {rep.generatedBy?.name ?? "System"}{rep.project && <> · <Link href={`/projects/${rep.project.id}`}>{rep.project.reference}</Link></>}</>}
        actions={<><StatusBadge status={rep.status} />{can(actor, "report.export") && <><Button variant="secondary" asChild><a href={`/api/reports/${rep.id}/pdf`}>PDF</a></Button><Button variant="secondary" asChild><a href={`/api/reports/${rep.id}/csv`}>CSV</a></Button></>}<PrintButton /></>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {doc.blocks.reduce<{ heading: string; blocks: typeof doc.blocks }[]>((acc, b) => {
            if (b.kind === "heading") acc.push({ heading: b.text, blocks: [] });
            else if (acc.length) acc[acc.length - 1].blocks.push(b);
            else acc.push({ heading: "", blocks: [b] });
            return acc;
          }, []).map((sec, i) => (
            <Card key={i}>{sec.heading && <CardHeader title={sec.heading} />}<CardBody className="space-y-3 text-sm">
              {sec.blocks.map((b, j) => b.kind === "paragraph" ? <p key={j} className="whitespace-pre-line">{b.text}</p>
                : b.kind === "fields" ? <dl key={j} className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(160px,240px)_1fr]">{b.rows.map(([k, v]) => [<dt key={`${k}-k`} className="text-muted">{k}</dt>, <dd key={`${k}-v`} className="whitespace-pre-line">{v}</dd>])}</dl>
                : b.kind === "table" ? <div key={j} className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{b.columns.map((c) => <th key={c} className="border-b border-line px-2 py-1 font-medium text-muted">{c}</th>)}</tr></thead><tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, l) => <td key={l} className="border-b border-line px-2 py-1">{c}</td>)}</tr>)}{!b.rows.length && <tr><td className="px-2 py-1 text-muted">No records</td></tr>}</tbody></table></div> : null)}
            </CardBody></Card>
          ))}
        </div>
        <aside className="space-y-4 no-print">
          {rep.status === "FINAL" ? (
            <Alert tone="success" title="Final">Finalised by {rep.finalizedBy?.name} on {formatDateTime(rep.finalizedAt)}. Generate a new version to reflect later changes.</Alert>
          ) : (
            <>
              {can(actor, "report.generate") && (
                <Card><CardHeader title="Draft summary" description="AI or rule-based draft from the report data." /><CardBody className="space-y-3">
                  <ActionForm action={draftSummaryAction} submitLabel="Draft summary" submitVariant="secondary"><input type="hidden" name="id" value={rep.id} /></ActionForm>
                  {rep.aiSummaryDraft && <pre className="whitespace-pre-wrap rounded-md border border-dashed border-navy-700/40 bg-navy-50/50 p-3 font-sans text-xs">{rep.aiSummaryDraft}</pre>}
                </CardBody></Card>
              )}
              {can(actor, "report.finalize") && (
                <Card><CardHeader title="Review and finalise" description="Edit the summary; your text becomes the official summary." /><CardBody>
                  <ActionForm action={finalizeReportAction} submitLabel="Finalise report" confirm="Finalise this report version? It cannot be edited afterwards.">
                    <input type="hidden" name="id" value={rep.id} />
                    <Field label="Reviewed summary" name="summary" required><Textarea rows={8} defaultValue={rep.aiSummaryDraft?.replace(/^\[.*?\]\n\n/, "") ?? ""} /></Field>
                  </ActionForm>
                </CardBody></Card>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
