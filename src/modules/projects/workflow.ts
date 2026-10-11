import type { ProjectStatus } from "@/generated/prisma/enums";
import type { Permission } from "@/modules/rbac/permissions";

/**
 * Project execution workflow. Completion review and MDA acceptance are
 * separate operations (projects/completion.ts) that drive the execution status
 * together with the separate acceptanceStatus field.
 */
export type ProjectAction =
  | "start_planning"
  | "start_work"
  | "put_on_hold"
  | "mark_blocked"
  | "resume"
  | "cancel"
  | "close"
  | "close_exceptional";

export interface ProjectRule {
  from: ProjectStatus[];
  to: ProjectStatus;
  permissions: Permission[];
  reasonRequired: boolean;
  /** Actor must be the project manager / an assigned officer (unless holding project.manage). */
  requiresAssignment: boolean;
  label: string;
}

export const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [
  "APPROVED", "PLANNING", "ASSIGNED", "AWAITING_ACKNOWLEDGMENT", "IN_PROGRESS", "ON_HOLD", "BLOCKED", "UNDER_REVIEW", "AWAITING_MDA_ACCEPTANCE", "ACCEPTED",
];
export const TERMINAL_PROJECT_STATUSES: ProjectStatus[] = ["CLOSED", "CANCELLED"];

export const PROJECT_TRANSITIONS: Record<ProjectAction, ProjectRule> = {
  start_planning: { from: ["APPROVED"], to: "PLANNING", permissions: ["project.assign", "project.manage"], reasonRequired: false, requiresAssignment: false, label: "Start planning" },
  start_work: { from: ["ASSIGNED"], to: "IN_PROGRESS", permissions: ["project.update"], reasonRequired: false, requiresAssignment: true, label: "Start implementation" },
  put_on_hold: { from: ["IN_PROGRESS", "BLOCKED", "ASSIGNED", "PLANNING"], to: "ON_HOLD", permissions: ["project.manage"], reasonRequired: true, requiresAssignment: false, label: "Put on hold" },
  mark_blocked: { from: ["IN_PROGRESS"], to: "BLOCKED", permissions: ["project.update"], reasonRequired: true, requiresAssignment: true, label: "Mark as blocked" },
  resume: { from: ["ON_HOLD", "BLOCKED"], to: "IN_PROGRESS", permissions: ["project.manage", "project.update"], reasonRequired: true, requiresAssignment: true, label: "Resume work" },
  cancel: { from: ["APPROVED", "PLANNING", "ASSIGNED", "AWAITING_ACKNOWLEDGMENT", "IN_PROGRESS", "ON_HOLD", "BLOCKED"], to: "CANCELLED", permissions: ["project.manage"], reasonRequired: true, requiresAssignment: false, label: "Cancel project" },
  close: { from: ["ACCEPTED"], to: "CLOSED", permissions: ["project.close"], reasonRequired: false, requiresAssignment: false, label: "Close project" },
  close_exceptional: {
    from: ["IN_PROGRESS", "ON_HOLD", "BLOCKED", "UNDER_REVIEW", "AWAITING_MDA_ACCEPTANCE", "ACCEPTED"],
    to: "CLOSED", permissions: ["project.close.exceptional"], reasonRequired: true, requiresAssignment: false, label: "Exceptional closure",
  },
};

export type ProjectCheck =
  | { ok: true; rule: ProjectRule }
  | { ok: false; error: string; code: "UNKNOWN_ACTION" | "INVALID_STATE" | "FORBIDDEN" | "REASON_REQUIRED" | "NOT_ASSIGNED" };

export function checkProjectTransition(
  action: string,
  current: ProjectStatus,
  ctx: { permissions: ReadonlySet<string>; isAssigned: boolean },
  reason?: string | null,
): ProjectCheck {
  if (!Object.prototype.hasOwnProperty.call(PROJECT_TRANSITIONS, action)) return { ok: false, error: "Unknown action.", code: "UNKNOWN_ACTION" };
  const rule = PROJECT_TRANSITIONS[action as ProjectAction];
  if (!rule.from.includes(current)) return { ok: false, error: `"${rule.label}" is not allowed while the project is ${current.replace(/_/g, " ").toLowerCase()}.`, code: "INVALID_STATE" };
  if (!rule.permissions.some((p) => ctx.permissions.has(p))) return { ok: false, error: "You are not authorised to perform this action.", code: "FORBIDDEN" };
  if (rule.requiresAssignment && !ctx.isAssigned && !ctx.permissions.has("project.manage")) {
    return { ok: false, error: "Only the assigned project team can perform this action.", code: "NOT_ASSIGNED" };
  }
  if (rule.reasonRequired && !reason?.trim()) return { ok: false, error: "A reason is required for this action.", code: "REASON_REQUIRED" };
  return { ok: true, rule };
}

export function availableProjectActions(current: ProjectStatus, ctx: { permissions: ReadonlySet<string>; isAssigned: boolean }): ProjectAction[] {
  return (Object.keys(PROJECT_TRANSITIONS) as ProjectAction[]).filter((a) => checkProjectTransition(a, current, ctx, "x").ok);
}
