import type { Block, PdfDoc } from "./pdf";
import type { ProjectReportData } from "./project-report";

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : "Not recorded");
const num = (n: number | null | undefined, unit = "") => (n === null || n === undefined ? "Not recorded" : `${n}${unit}`);
const people = (p: { name: string }[] | null | undefined) => (p && p.length ? p.map((x) => x.name).join(", ") : "Not recorded");

/** Converts a project completion report snapshot into PDF blocks. */
export function projectReportDoc(d: ProjectReportData, meta: { version: number; status: string; summary?: string | null }): PdfDoc {
  const t = d.timeline;
  const p = d.performance;
  const o = d.outcomes;
  const a = d.accountability;
  const blocks: Block[] = [
    { kind: "heading", text: "1. Project identification" },
    { kind: "fields", rows: [
      ["Project reference", d.identification.projectReference], ["Request reference", d.identification.requestReference ?? "Not recorded"],
      ["Project title", d.identification.title], ["MDA", d.identification.mda], ["Service category", d.identification.serviceCategory],
      ["Service", d.identification.service], ["Project manager", d.identification.projectManager?.name ?? "Not recorded"],
      ["Assigned officers", people(d.identification.officers)], ["Department", d.identification.department ?? "Not recorded"],
    ] },
    ...(meta.summary ? [{ kind: "heading", text: "Executive summary (reviewed)" } as Block, { kind: "paragraph", text: meta.summary } as Block] : []),
    { kind: "heading", text: "2. Timeline" },
    { kind: "fields", rows: [
      ["Request created", fmt(t.requestCreated)], ["Submitted", fmt(t.submitted)], ["Initial review", fmt(t.initialReview)], ["Approved", fmt(t.approved)],
      ["Assigned", fmt(t.assigned)], ["Assignment acknowledged", fmt(t.acknowledged)], ["Implementation started", fmt(t.started)],
      ["Planned completion", fmt(t.plannedCompletion)], ["Completion submitted", fmt(t.completionSubmitted)], ["MDA accepted", fmt(t.mdaAccepted)], ["Closed", fmt(t.closed)],
    ] },
    { kind: "heading", text: "3. Performance" },
    { kind: "fields", rows: [
      ["Calendar days (submission to closure)", num(p.calendarDaysSubmissionToClosure)], ["Working days (submission to closure)", num(p.workingDaysSubmissionToClosure)],
      ["Execution duration (days)", num(p.executionDurationDays)], ["Planned vs actual", p.plannedVsActual ?? "Not recorded"], ["Delay (days)", num(p.delayDays)],
      ["Awaiting MDA information (working days)", num(p.daysAwaitingMdaInformation)], ["Awaiting approval (working days)", num(p.daysAwaitingApproval)],
      ["Blocked (working days)", num(p.daysBlocked)], ["Milestones completed", `${p.milestonesCompleted} of ${p.milestonesTotal}`],
      ["Change requests", String(p.changeRequests)], ["Risks recorded", String(p.risksRecorded)], ["Completion review cycles", String(p.reviewCycles)], ["Remediation cycles", String(p.remediationCycles)],
    ] },
    { kind: "heading", text: "4. Outcomes" },
    { kind: "fields", rows: [["Original problem", o.originalProblem ?? "Not recorded"], ["Approved scope", o.approvedScope ?? "Not recorded"], ["Actual outcome", o.actualOutcome ?? "Not recorded"], ["MDA acceptance decision", o.mdaAcceptanceDecision ?? "Not recorded"], ["MDA rating", o.mdaRating === null ? "Not recorded" : `${o.mdaRating} / 5`], ["Lessons learned", o.lessonsLearned ?? "Not recorded"], ["Follow-up recommendations", o.followUpRecommendations ?? "Not recorded"], ["Closure type", o.closureType ?? "Not recorded"], ...(o.exceptionalJustification ? [["Exceptional closure justification", o.exceptionalJustification] as [string, string]] : [])] },
    { kind: "table", columns: ["Deliverable", "Required", "Status"], rows: o.deliverables.map((x) => [x.title, x.required ? "Yes" : "No", x.status]) },
    { kind: "heading", text: "5. Accountability" },
    { kind: "fields", rows: [["Approved by", people(a.approvedBy)], ["Assigned by", a.assignedBy?.name ?? "Not recorded"], ["Work performed by", people(a.performedBy)], ["Completion reviewed by", a.completionReviewedBy?.name ?? "Not recorded"], ["Deliverables accepted by", a.acceptedBy?.name ?? "Not recorded"], ["Closed by", a.closedBy?.name ?? "Not recorded"]] },
  ];
  return {
    title: `Project Completion Report`, subtitle: d.identification.title, reference: d.identification.projectReference,
    version: String(meta.version), status: meta.status, generatedAt: new Date(d.generatedAt).toISOString().replace("T", " ").slice(0, 16) + " UTC", blocks,
  };
}

/** Generic renderer for periodic report snapshots: each section becomes a table or field list. */
export function periodicReportDoc(rep: { title: string; version: number; status: string; data: unknown; generatedAt: Date; summary?: string | null }): PdfDoc {
  const data = rep.data as { period?: string; sections?: Record<string, unknown> };
  const blocks: Block[] = [];
  if (rep.summary) blocks.push({ kind: "heading", text: "Summary" }, { kind: "paragraph", text: rep.summary });
  for (const [name, value] of Object.entries(data.sections ?? {})) {
    blocks.push({ kind: "heading", text: name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) });
    blocks.push(...valueBlocks(value));
  }
  return { title: rep.title, subtitle: data.period ? `Period: ${data.period}` : undefined, version: String(rep.version), status: rep.status, generatedAt: rep.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC", blocks };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const o = v as Record<string, unknown>;
    if ("name" in o) return String(o.name);
    if ("abbreviation" in o) return String(o.abbreviation);
    if ("reference" in o) return String(o.reference);
    return JSON.stringify(v);
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s;
}

export function valueBlocks(value: unknown): Block[] {
  if (Array.isArray(value)) {
    if (!value.length) return [{ kind: "paragraph", text: "No records." }];
    if (typeof value[0] === "object" && value[0] !== null) {
      const cols = Object.keys(value[0] as object).filter((k) => !["id", "mdaId", "departmentId", "categoryId", "skills"].includes(k)).slice(0, 7);
      return [{ kind: "table", columns: cols.map((c) => c.replace(/([A-Z])/g, " $1")), rows: value.map((row) => cols.map((c) => cell((row as Record<string, unknown>)[c]))) }];
    }
    return [{ kind: "paragraph", text: value.join(", ") }];
  }
  if (value && typeof value === "object") {
    return [{ kind: "fields", rows: Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.replace(/([A-Z_])/g, " $1"), cell(v)] as [string, string]) }];
  }
  return [{ kind: "paragraph", text: cell(value) }];
}
