/**
 * Permission catalogue and default role → permission matrix.
 *
 * Application code checks PERMISSIONS, never role names. Roles are data:
 * the matrix below seeds the database and administrators may adjust role
 * permissions through Admin › Roles (with safeguards in rbac/service.ts).
 */

export const PERMISSIONS = {
  // System administration
  "system.settings.manage": "Manage system-wide configuration",
  "system.health.view": "View system health and operational metrics",
  "system.ai.configure": "Configure AI providers and AI policies",
  "system.notifications.manage": "Manage notification templates and delivery queue",
  // Users and roles
  "user.read": "View user accounts",
  "user.manage": "Create, invite, suspend and reactivate KATDICT/oversight users",
  "role.manage": "Edit role permissions",
  "role.assign": "Assign roles to users",
  // Departments
  "department.read": "View departments",
  "department.manage": "Create and manage departments",
  // MDAs
  "mda.read.all": "View all MDA records",
  "mda.review": "Approve, reject or request corrections to MDA registrations",
  "mda.manage": "Suspend, reactivate and edit any MDA",
  "mda.import": "Import the verified MDA directory from CSV",
  "mda.profile.edit.own": "Maintain own MDA profile",
  "mda.users.manage.own": "Invite and manage users within own MDA",
  // Catalog
  "catalog.manage": "Manage service categories, services and approval policies",
  // Requests
  "request.create": "Create and submit service requests",
  "request.read.all": "View all service requests",
  "request.read.department": "View requests assigned to own department",
  "request.read.mda": "View all requests of own MDA",
  "request.read.own": "View requests created by self",
  "request.respond": "Respond to clarification requests",
  "request.withdraw": "Withdraw own MDA's requests before approval",
  "request.triage": "Triage new submissions",
  "request.assess": "Assess requests and request information",
  "request.evaluate.technical": "Record technical evaluations",
  "request.scope": "Record scope and estimation",
  "request.decide": "Reject or defer requests",
  "request.approve.technical": "Approve requests at the technical step",
  "request.approve.department": "Approve requests at the departmental step",
  "request.approve.executive": "Approve requests at the executive step",
  // Projects
  "project.create": "Initiate projects from approved requests",
  "project.read.all": "View all projects",
  "project.read.department": "View projects of own department",
  "project.read.mda": "View projects of own MDA",
  "project.read.assigned": "View projects assigned to self",
  "project.assign": "Assign departments, project managers and officers to any project",
  "project.assign.department": "Assign officers within own department",
  "project.update": "Update milestones, tasks, logs, risks and deliverables on accessible projects",
  "project.manage": "Change project execution status (hold, block, cancel, resume)",
  "project.completion.submit": "Submit completion evidence for review",
  "project.completion.review": "Review completion submissions",
  "project.accept": "Accept or dispute project completion on behalf of an MDA",
  "project.close": "Close projects after acceptance",
  "project.close.exceptional": "Close projects under the exceptional closure policy",
  "project.scope.request": "Request scope changes",
  "project.scope.decide": "Approve or reject scope changes",
  "project.comment.internal": "Read and write internal KATDICT notes",
  "project.comment.external": "Read and write MDA-visible messages",
  // Reporting and analytics
  "report.read.all": "View all reports",
  "report.read.mda": "View own MDA reports",
  "report.generate": "Generate reports",
  "report.finalize": "Finalise official reports",
  "report.export": "Export reports (CSV/PDF)",
  "analytics.executive": "Executive dashboard and statewide analytics",
  "analytics.operations": "Operations dashboard",
  "analytics.department": "Department dashboard",
  // Feedback & complaints
  "feedback.submit": "Submit feedback and ratings",
  "feedback.read.all": "View all feedback",
  "complaint.submit": "Submit complaints",
  "complaint.read.all": "View all complaints",
  "complaint.manage": "Handle, escalate and resolve complaints",
  // Knowledge
  "knowledge.read": "Search the knowledge repository",
  "knowledge.manage": "Create, approve and publish knowledge documents",
  // Oversight
  "audit.read": "View audit logs and decision trails",
  "earlywarning.view": "View the early warning centre",
  "escalation.configure": "Configure escalation rules and SLA calendars",
  "dataquality.view": "View the data quality centre",
  // AI
  "ai.use": "Use AI assistance features",
  "ai.briefing": "Generate executive intelligence briefings",
  "ai.analytics": "Ask natural-language analytics questions",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function permissionModule(p: string): string {
  return p.split(".")[0];
}

export type RoleKey =
  | "SUPER_ADMIN"
  | "DIRECTOR"
  | "OPERATIONS_ADMIN"
  | "DEPARTMENT_HEAD"
  | "PROJECT_OFFICER"
  | "MDA_ADMIN"
  | "MDA_STAFF"
  | "AUDITOR";

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  userType: "KATDICT_STAFF" | "MDA_USER" | "OVERSIGHT";
  privileged: boolean;
  permissions: Permission[];
}

const READ_ALL: Permission[] = ["request.read.all", "project.read.all", "mda.read.all", "report.read.all"];

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    key: "SUPER_ADMIN",
    name: "Super Administrator",
    description: "System administration. Deliberately excluded from operational approvals (separation of duties).",
    userType: "KATDICT_STAFF",
    privileged: true,
    permissions: [
      "system.settings.manage", "system.health.view", "system.ai.configure", "system.notifications.manage",
      "user.read", "user.manage", "role.manage", "role.assign",
      "department.read", "department.manage", "catalog.manage", "mda.import",
      ...READ_ALL, "report.generate", "report.export", "audit.read", "dataquality.view",
      "escalation.configure", "earlywarning.view", "knowledge.read", "complaint.read.all", "feedback.read.all",
    ],
  },
  {
    key: "DIRECTOR",
    name: "Director / Director-General",
    description: "Executive oversight and executive-level approvals.",
    userType: "KATDICT_STAFF",
    privileged: true,
    permissions: [
      ...READ_ALL, "user.read", "department.read",
      "mda.review", "request.decide", "request.approve.executive",
      "project.scope.decide", "project.close.exceptional", "project.comment.internal", "project.comment.external",
      "report.generate", "report.finalize", "report.export",
      "analytics.executive", "analytics.operations", "analytics.department",
      "complaint.read.all", "complaint.manage", "feedback.read.all",
      "knowledge.read", "audit.read", "earlywarning.view", "dataquality.view",
      "ai.use", "ai.briefing", "ai.analytics",
    ],
  },
  {
    key: "OPERATIONS_ADMIN",
    name: "KATDICT Operations Administrator",
    description: "Triage, assessment, assignment, delivery tracking and closure.",
    userType: "KATDICT_STAFF",
    privileged: true,
    permissions: [
      ...READ_ALL, "user.read", "department.read",
      "mda.review", "mda.manage", "mda.import",
      "request.triage", "request.assess", "request.evaluate.technical", "request.scope", "request.decide",
      "request.approve.technical",
      "project.create", "project.assign", "project.manage", "project.update", "project.completion.review", "project.close",
      "project.scope.request", "project.scope.decide", "project.comment.internal", "project.comment.external",
      "report.generate", "report.finalize", "report.export", "analytics.operations", "analytics.department",
      "complaint.read.all", "complaint.manage", "feedback.read.all",
      "knowledge.read", "knowledge.manage", "earlywarning.view", "escalation.configure", "dataquality.view",
      "ai.use", "ai.analytics", "ai.briefing",
    ],
  },
  {
    key: "DEPARTMENT_HEAD",
    name: "Department Head",
    description: "Departmental work queue, officer assignment and departmental approvals.",
    userType: "KATDICT_STAFF",
    privileged: false,
    permissions: [
      "user.read", "department.read",
      "request.read.department", "request.evaluate.technical", "request.approve.department",
      "project.read.department", "project.assign.department", "project.update", "project.completion.review",
      "project.scope.request", "project.comment.internal", "project.comment.external",
      "report.generate", "report.export", "analytics.department", "earlywarning.view",
      "knowledge.read", "knowledge.manage", "ai.use",
    ],
  },
  {
    key: "PROJECT_OFFICER",
    name: "Project Manager / ICT Officer",
    description: "Delivers assigned projects.",
    userType: "KATDICT_STAFF",
    privileged: false,
    permissions: [
      "project.read.assigned", "project.update", "project.completion.submit", "project.scope.request",
      "project.comment.internal", "project.comment.external", "knowledge.read", "ai.use",
    ],
  },
  {
    key: "MDA_ADMIN",
    name: "MDA Account Administrator",
    description: "Manages an MDA's profile and users; submits and accepts work.",
    userType: "MDA_USER",
    privileged: false,
    permissions: [
      "mda.profile.edit.own", "mda.users.manage.own",
      "request.create", "request.read.mda", "request.respond", "request.withdraw",
      "project.read.mda", "project.accept", "project.scope.request", "project.comment.external",
      "report.read.mda", "report.export", "feedback.submit", "complaint.submit", "knowledge.read", "ai.use",
    ],
  },
  {
    key: "MDA_STAFF",
    name: "MDA Staff",
    description: "Submits and tracks requests within MDA policy.",
    userType: "MDA_USER",
    privileged: false,
    permissions: [
      "request.create", "request.read.own", "request.respond", "project.read.mda",
      "project.comment.external", "feedback.submit", "complaint.submit", "knowledge.read", "ai.use",
    ],
  },
  {
    key: "AUDITOR",
    name: "Auditor / Oversight Officer",
    description: "Read-only oversight of records, decisions and audit trails.",
    userType: "OVERSIGHT",
    privileged: false,
    permissions: [
      ...READ_ALL, "audit.read", "report.generate", "report.export", "complaint.read.all", "feedback.read.all",
      "knowledge.read", "dataquality.view", "earlywarning.view", "department.read", "user.read",
    ],
  },
];

/** Permissions that must never be granted to roles held by MDA users. */
export const KATDICT_ONLY_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter(
  (p) =>
    p.startsWith("system.") || p.startsWith("role.") || p === "user.manage" || p.endsWith(".all") ||
    ["mda.review", "mda.manage", "mda.import", "catalog.manage", "request.triage", "request.assess",
      "request.evaluate.technical", "request.scope", "request.decide", "request.approve.technical",
      "request.approve.department", "request.approve.executive", "project.create", "project.assign",
      "project.assign.department", "project.update", "project.manage", "project.completion.submit",
      "project.completion.review", "project.close", "project.close.exceptional", "project.scope.decide",
      "project.comment.internal", "audit.read", "knowledge.manage", "complaint.manage", "report.finalize",
      "analytics.executive", "analytics.operations", "analytics.department", "ai.briefing", "ai.analytics",
      "escalation.configure", "dataquality.view", "earlywarning.view"].includes(p),
);

/** Auditor roles may never hold mutating operational permissions. */
export const OVERSIGHT_FORBIDDEN_PREFIXES = [
  "request.triage", "request.assess", "request.approve", "request.decide", "request.scope", "request.evaluate",
  "project.update", "project.manage", "project.assign", "project.close", "project.completion", "project.scope.decide",
  "mda.review", "mda.manage", "user.manage", "role.", "system.", "catalog.manage", "report.finalize",
];

export const PRIVILEGED_ROLE_KEYS = DEFAULT_ROLES.filter((r) => r.privileged).map((r) => r.key);
