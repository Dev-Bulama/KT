import type { Actor } from "@/modules/rbac/actor";
import type { Permission } from "@/modules/rbac/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  any?: Permission[];
  when?: (a: Actor) => boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/requests", label: "Service requests", icon: "ClipboardList", any: ["request.read.all", "request.read.department", "request.read.mda", "request.read.own", "request.create", "request.triage", "request.assess"] },
      { href: "/approvals", label: "Approvals", icon: "Stamp", any: ["request.approve.technical", "request.approve.department", "request.approve.executive"] },
      { href: "/projects", label: "Projects", icon: "FolderKanban", any: ["project.read.all", "project.read.department", "project.read.mda", "project.read.assigned"] },
      { href: "/early-warning", label: "Early warning", icon: "Siren", any: ["earlywarning.view"] },
      { href: "/intelligence", label: "Intelligence", icon: "LineChart", any: ["analytics.executive", "analytics.operations", "analytics.department"] },
      { href: "/reports", label: "Reports", icon: "FileBarChart", any: ["report.read.all", "report.generate", "report.read.mda"] },
    ],
  },
  {
    label: "Institutions",
    items: [
      { href: "/mdas", label: "MDA directory", icon: "Building2", any: ["mda.read.all", "mda.review"] },
      { href: "/my-mda", label: "My MDA", icon: "Building", when: (a) => a.userType === "MDA_USER" },
      { href: "/feedback", label: "Feedback & complaints", icon: "MessageSquareWarning", any: ["feedback.submit", "feedback.read.all", "complaint.submit", "complaint.manage", "complaint.read.all"] },
    ],
  },
  {
    label: "Knowledge & AI",
    items: [
      { href: "/knowledge", label: "Knowledge repository", icon: "BookOpen", any: ["knowledge.read"] },
      { href: "/assistant", label: "AI assistant", icon: "Sparkles", any: ["ai.use"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users", icon: "Users", any: ["user.read"] },
      { href: "/admin/roles", label: "Roles & permissions", icon: "KeyRound", any: ["role.manage"] },
      { href: "/admin/departments", label: "Departments", icon: "Network", any: ["department.manage"] },
      { href: "/admin/catalog", label: "Service catalogue", icon: "Layers", any: ["catalog.manage"] },
      { href: "/admin/audit", label: "Audit log", icon: "ScrollText", any: ["audit.read"] },
      { href: "/admin/data-quality", label: "Data quality", icon: "ShieldCheck", any: ["dataquality.view"] },
      { href: "/admin/settings", label: "System settings", icon: "Settings", any: ["system.settings.manage", "system.ai.configure", "escalation.configure"] },
      { href: "/admin/outbox", label: "Notification queue", icon: "Send", any: ["system.notifications.manage"] },
      { href: "/admin/email", label: "Email delivery (SMTP)", icon: "Mail", any: ["system.notifications.manage"] },
      { href: "/admin/site", label: "Website content", icon: "PanelsTopLeft", any: ["site.content.manage"] },
      { href: "/admin/branding", label: "Branding & logo", icon: "Image", any: ["site.content.manage"] },
      { href: "/admin/chatbot", label: "Chatbot widget", icon: "MessageCircle", any: ["system.settings.manage"] },
      { href: "/admin/health", label: "System health", icon: "Activity", any: ["system.health.view"] },
    ],
  },
];

export interface ClientNavSection {
  label?: string;
  items: { href: string; label: string; icon: string }[];
}

/** Filters navigation by permission and returns plain serialisable data for the client sidebar. */
export function visibleNav(actor: Actor): ClientNavSection[] {
  return NAV.map((s) => ({
    label: s.label,
    items: s.items
      .filter((i) => (!i.any || i.any.some((p) => actor.permissions.has(p))) && (!i.when || i.when(actor)))
      .map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((s) => s.items.length);
}
