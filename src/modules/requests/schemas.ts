import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";

const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : undefined));
const required = (label: string, min: number, max: number) =>
  z.string().trim().min(min, `${label} is required (at least ${min} characters)`).max(max);

const dateInput = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

/** Fields an MDA may set. KATDICT-only fields (priority, department, estimates) are excluded: mass-assignment safe. */
export const requestDraftSchema = z.object({
  serviceId: z.string().cuid("Select a service"),
  title: required("Title", 5, 200),
  problemStatement: text(5000),
  currentSituation: text(5000),
  desiredOutcome: text(5000),
  businessJustification: text(5000),
  expectedBeneficiaries: text(2000),
  estimatedUsers: z.union([z.literal("").transform(() => undefined), z.null().transform(() => undefined), z.coerce.number().int().min(0).max(10_000_000)]).optional(),
  urgency: z.nativeEnum(Priority).default("MEDIUM"),
  preferredCompletionDate: dateInput,
  existingSystems: text(3000),
  technicalInformation: text(5000),
  knownDependencies: text(3000),
  expectedDeliverables: text(5000),
  successCriteria: text(5000),
  institutionalImpact: text(5000),
  operationalUrgency: text(3000),
  legalConsiderations: text(3000),
  consequencesOfInaction: text(5000),
});
export type RequestDraftInput = z.infer<typeof requestDraftSchema>;

/** Completeness rules applied at submission. */
export const requestSubmitSchema = requestDraftSchema.extend({
  problemStatement: required("Problem statement", 30, 5000),
  desiredOutcome: required("Desired outcome", 15, 5000),
  businessJustification: required("Business justification", 15, 5000),
  expectedDeliverables: required("Expected deliverables", 5, 5000),
  successCriteria: required("Success criteria", 5, 5000),
  institutionalImpact: required("Institutional impact", 10, 5000),
  consequencesOfInaction: required("Consequences of not addressing the request", 10, 5000),
});

export const triageSchema = z.object({
  priority: z.nativeEnum(Priority),
  assignedDepartmentId: z.string().cuid("Select a department"),
  assessorId: z.string().cuid().optional().or(z.literal("").transform(() => undefined)),
  note: text(3000),
});

export const assessmentSchema = z.object({
  stage: z.enum(["TRIAGE", "ASSESSMENT", "TECHNICAL", "SCOPE"]),
  findings: required("Findings", 10, 10000),
  recommendation: text(5000),
  recommendedPriority: z.nativeEnum(Priority).optional().or(z.literal("").transform(() => undefined)),
  estimatedEffortDays: z.coerce.number().int().min(1).max(3650).optional().or(z.literal("").transform(() => undefined)),
  estimatedCostNgn: z.coerce.number().min(0).max(1e13).optional().or(z.literal("").transform(() => undefined)),
  proposedScope: text(10000),
  checklist: z.record(z.string(), z.boolean()).optional(),
});
export type AssessmentInput = z.infer<typeof assessmentSchema>;
