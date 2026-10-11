import { cn, humanize } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "navy";
const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-info-100 text-info-700 ring-navy-100",
  success: "bg-accent-100 text-accent-700 ring-green-200",
  warning: "bg-warn-100 text-warn-700 ring-amber-200",
  danger: "bg-danger-100 text-danger-700 ring-red-200",
  navy: "bg-navy-900 text-white ring-navy-900",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  DRAFT: "neutral", SUBMITTED: "info", INITIAL_TRIAGE: "info", UNDER_ASSESSMENT: "info", TECHNICAL_EVALUATION: "info", SCOPE_ESTIMATION: "info",
  APPROVAL_REVIEW: "warning", NEEDS_INFORMATION: "warning", RETURNED_FOR_REVISION: "warning", DEFERRED: "neutral",
  APPROVED: "success", PROJECT_INITIATED: "success", REJECTED: "danger", WITHDRAWN: "neutral",
  PLANNING: "info", ASSIGNED: "info", AWAITING_ACKNOWLEDGMENT: "warning", IN_PROGRESS: "info", ON_HOLD: "neutral", BLOCKED: "danger",
  UNDER_REVIEW: "warning", AWAITING_MDA_ACCEPTANCE: "warning", ACCEPTED: "success", CLOSED: "navy", CANCELLED: "neutral",
  NOT_SUBMITTED: "neutral", UNDER_KATDICT_REVIEW: "warning", RETURNED_FOR_CORRECTION: "warning", AWAITING_MDA: "warning", DISPUTED: "danger",
  ACTIVE: "success", PENDING_REVIEW: "warning", CHANGES_REQUESTED: "warning", SUSPENDED: "danger", DIRECTORY: "neutral", PENDING_VERIFICATION: "warning", DEACTIVATED: "neutral",
  LOW: "neutral", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger",
  OPEN: "warning", MITIGATED: "info", RESOLVED: "success", ESCALATED: "danger",
  PENDING: "neutral", COMPLETED: "success", TODO: "neutral", DONE: "success", PLANNED: "neutral",
  ON_TRACK: "success", AT_RISK: "warning", BREACHED: "danger", MET: "success", NOT_APPLICABLE: "neutral",
  FINAL: "navy", PUBLISHED: "success", ARCHIVED: "neutral", SENT: "success", FAILED: "warning", DEAD: "danger", PROCESSING: "info",
  PENDING_ACKNOWLEDGMENT: "warning", ACKNOWLEDGED: "success", REASSIGNED: "neutral", REMOVED: "neutral",
  QUARANTINED: "danger", CLEAN: "success", NOT_SCANNED: "neutral",
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <Badge className={className}>—</Badge>;
  return <Badge tone={STATUS_TONES[status] ?? "neutral"} className={className}>{humanize(status)}</Badge>;
}
