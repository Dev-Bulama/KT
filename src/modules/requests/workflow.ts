import type { RequestStatus } from "@/generated/prisma/enums";
import type { Permission } from "@/modules/rbac/permissions";

/**
 * Service-request review workflow (state machine).
 *
 * The browser never submits a target status: it submits an ACTION, and the
 * server derives the target status from this table after validating the
 * current status and the actor's permissions.
 */

export type RequestAction =
  | "submit"
  | "withdraw"
  | "start_triage"
  | "accept_for_assessment"
  | "request_information"
  | "mda_respond"
  | "send_to_technical_evaluation"
  | "complete_technical_evaluation"
  | "submit_for_approval"
  | "approval_decision"
  | "resume_after_return"
  | "reject"
  | "defer"
  | "reactivate"
  | "initiate_project";

export interface TransitionRule {
  from: RequestStatus[];
  /** Target status; "approval" means computed by the approval policy. */
  to: RequestStatus | "approval";
  /** Actor needs ANY of these permissions. */
  permissions: Permission[];
  reasonRequired: boolean;
  label: string;
  /** Which side performs this action. */
  side: "MDA" | "KATDICT";
}

export const REQUEST_TRANSITIONS: Record<RequestAction, TransitionRule> = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", permissions: ["request.create"], reasonRequired: false, label: "Submit request", side: "MDA" },
  withdraw: {
    from: ["SUBMITTED", "INITIAL_TRIAGE", "UNDER_ASSESSMENT", "NEEDS_INFORMATION"],
    to: "WITHDRAWN", permissions: ["request.withdraw"], reasonRequired: true, label: "Withdraw request", side: "MDA",
  },
  start_triage: { from: ["SUBMITTED"], to: "INITIAL_TRIAGE", permissions: ["request.triage"], reasonRequired: false, label: "Start triage", side: "KATDICT" },
  accept_for_assessment: {
    from: ["INITIAL_TRIAGE"], to: "UNDER_ASSESSMENT", permissions: ["request.triage"], reasonRequired: false,
    label: "Accept for assessment", side: "KATDICT",
  },
  request_information: {
    from: ["INITIAL_TRIAGE", "UNDER_ASSESSMENT", "TECHNICAL_EVALUATION", "SCOPE_ESTIMATION"],
    to: "NEEDS_INFORMATION", permissions: ["request.assess", "request.triage"], reasonRequired: true,
    label: "Request information from MDA", side: "KATDICT",
  },
  mda_respond: { from: ["NEEDS_INFORMATION"], to: "UNDER_ASSESSMENT", permissions: ["request.respond"], reasonRequired: true, label: "Submit response", side: "MDA" },
  send_to_technical_evaluation: {
    from: ["UNDER_ASSESSMENT"], to: "TECHNICAL_EVALUATION", permissions: ["request.assess"], reasonRequired: false,
    label: "Send to technical evaluation", side: "KATDICT",
  },
  complete_technical_evaluation: {
    from: ["TECHNICAL_EVALUATION"], to: "SCOPE_ESTIMATION", permissions: ["request.evaluate.technical"], reasonRequired: false,
    label: "Complete technical evaluation", side: "KATDICT",
  },
  submit_for_approval: {
    from: ["SCOPE_ESTIMATION"], to: "APPROVAL_REVIEW", permissions: ["request.scope"], reasonRequired: false,
    label: "Submit for approval", side: "KATDICT",
  },
  approval_decision: {
    from: ["APPROVAL_REVIEW"], to: "approval",
    permissions: ["request.approve.technical", "request.approve.department", "request.approve.executive"],
    reasonRequired: false, label: "Record approval decision", side: "KATDICT",
  },
  resume_after_return: {
    from: ["RETURNED_FOR_REVISION"], to: "SCOPE_ESTIMATION", permissions: ["request.scope"], reasonRequired: false,
    label: "Resume scope revision", side: "KATDICT",
  },
  reject: {
    from: ["INITIAL_TRIAGE", "UNDER_ASSESSMENT", "TECHNICAL_EVALUATION", "SCOPE_ESTIMATION", "RETURNED_FOR_REVISION"],
    to: "REJECTED", permissions: ["request.decide"], reasonRequired: true, label: "Reject request", side: "KATDICT",
  },
  defer: {
    from: ["INITIAL_TRIAGE", "UNDER_ASSESSMENT", "TECHNICAL_EVALUATION", "SCOPE_ESTIMATION"],
    to: "DEFERRED", permissions: ["request.decide"], reasonRequired: true, label: "Defer request", side: "KATDICT",
  },
  reactivate: { from: ["DEFERRED"], to: "UNDER_ASSESSMENT", permissions: ["request.decide"], reasonRequired: true, label: "Reactivate request", side: "KATDICT" },
  initiate_project: { from: ["APPROVED"], to: "PROJECT_INITIATED", permissions: ["project.create"], reasonRequired: false, label: "Initiate project", side: "KATDICT" },
};

export const TERMINAL_REQUEST_STATUSES: RequestStatus[] = ["REJECTED", "WITHDRAWN", "PROJECT_INITIATED"];
/** Statuses in which the SLA clock is paused (waiting on the MDA or deliberately deferred). */
export const PAUSED_REQUEST_STATUSES: RequestStatus[] = ["NEEDS_INFORMATION", "DEFERRED", "DRAFT"];
export const OPEN_REVIEW_STATUSES: RequestStatus[] = [
  "SUBMITTED", "INITIAL_TRIAGE", "UNDER_ASSESSMENT", "NEEDS_INFORMATION", "TECHNICAL_EVALUATION",
  "SCOPE_ESTIMATION", "APPROVAL_REVIEW", "RETURNED_FOR_REVISION", "DEFERRED",
];

export type TransitionCheck =
  | { ok: true; to: RequestStatus | "approval"; rule: TransitionRule }
  | { ok: false; error: string; code: "UNKNOWN_ACTION" | "INVALID_STATE" | "FORBIDDEN" | "REASON_REQUIRED" };

export function checkRequestTransition(
  action: string,
  current: RequestStatus,
  permissions: ReadonlySet<string>,
  reason?: string | null,
): TransitionCheck {
  if (!Object.prototype.hasOwnProperty.call(REQUEST_TRANSITIONS, action)) {
    return { ok: false, error: "Unknown action.", code: "UNKNOWN_ACTION" };
  }
  const rule = REQUEST_TRANSITIONS[action as RequestAction];
  if (!rule.from.includes(current)) {
    return { ok: false, error: `"${rule.label}" is not allowed while the request is ${current.replace(/_/g, " ").toLowerCase()}.`, code: "INVALID_STATE" };
  }
  if (!rule.permissions.some((p) => permissions.has(p))) {
    return { ok: false, error: "You are not authorised to perform this action.", code: "FORBIDDEN" };
  }
  if (rule.reasonRequired && !reason?.trim()) {
    return { ok: false, error: "A reason is required for this action.", code: "REASON_REQUIRED" };
  }
  return { ok: true, to: rule.to, rule };
}

/** Actions available to an actor for a request in a given status (for rendering controls). */
export function availableRequestActions(current: RequestStatus, permissions: ReadonlySet<string>): RequestAction[] {
  return (Object.keys(REQUEST_TRANSITIONS) as RequestAction[]).filter((a) => {
    const r = REQUEST_TRANSITIONS[a];
    return r.from.includes(current) && r.permissions.some((p) => permissions.has(p));
  });
}
