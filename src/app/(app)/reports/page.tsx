import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { listReports, REPORT_TEMPLATES } from "@/modules/reports/periodic";
import { prisma } from "@/lib/db";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, humanize } from "@/lib/utils";
import { generateReportAction } from "./actions";

export const metadata = { title: "Government Reporting Center" };

export default async function Reports() {
  const actor = await requirePageActor();
  const [reports, mdas, depts] = await Promise.all([
    listReports(actor),
    actor.userType === "MDA_USER" ? prisma.mda.findMany({ where: { id: actor.mdaId ?? "" }, select: { id: true, name: true } }) : prisma.mda.findMany({ where: { status: { in: ["ACTIVE", "SUSPENDED"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  const templates = (Object.entries(REPORT_TEMPLATES) as [keyof typeof REPORT_TEMPLATES, { label: string }][]).filter(([k]) => (k === "AUDIT_COMPLIANCE" ? can(actor, "audit.read") : true) && (actor.userType === "MDA_USER" ? k === "MDA_DELIVERY" : true));
  return (
    <>
      <PageHeader title="Government Reporting Center" description="Generate reports from live records. Each generation is versioned and timestamped; AI-drafted summaries require human review before finalisation." />
      {can(actor, "report.generate") && (
        <Card className="mb-6"><CardHeader title="Generate a report" /><CardBody>
          <ActionForm action={generateReportAction} submitLabel="Generate report">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Template" name="template" required className="md:col-span-2"><Select defaultValue={templates[0]?.[0]}>{templates.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
              <Field label="Month (monthly)" name="month"><Input type="month" defaultValue={now.toISOString().slice(0, 7)} /></Field>
              <Field label="Quarter (quarterly)" name="quarter"><Select defaultValue={`${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`}>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const y = now.getFullYear() - Math.floor(i / 4); const q = 4 - (i % 4); return <option key={i} value={`${y}-Q${q}`}>{y} Q{q}</option>; })}</Select></Field>
              <Field label="Year (annual)" name="year"><Input type="number" defaultValue={now.getFullYear()} min={2020} max={2100} /></Field>
              <Field label="MDA (MDA report)" name="mdaId"><Select defaultValue={actor.mdaId ?? ""}><option value="">—</option>{mdas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
              {actor.userType !== "MDA_USER" && <Field label="Department (workload)" name="departmentId"><Select defaultValue=""><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>}
              <Field label="From (audit)" name="from"><Input type="date" /></Field>
              <Field label="To (audit)" name="to"><Input type="date" /></Field>
            </div>
          </ActionForm>
        </CardBody></Card>
      )}
      {reports.length === 0 ? <EmptyState title="No reports yet" /> : (
        <Table caption="Reports">
          <THead><tr><TH>Report</TH><TH>Type</TH><TH>Version</TH><TH>Status</TH><TH>Generated</TH><TH>Downloads</TH></tr></THead>
          <tbody>{reports.map((r) => (
            <TR key={r.id}><TD><Link href={`/reports/${r.id}`}>{r.title}</Link></TD><TD className="text-muted">{humanize(r.type)}</TD><TD>v{r.version}</TD><TD><StatusBadge status={r.status} /></TD><TD className="text-xs text-muted">{formatDateTime(r.generatedAt)}<br />{r.generatedBy?.name ?? "System"}</TD>
              <TD className="whitespace-nowrap text-sm">{can(actor, "report.export") ? <><a href={`/api/reports/${r.id}/pdf`}>PDF</a> · <a href={`/api/reports/${r.id}/csv`}>CSV</a></> : "—"}</TD></TR>
          ))}</tbody>
        </Table>
      )}
    </>
  );
}
