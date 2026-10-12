import { z } from "zod";

/**
 * Public-website content model (CMS). Each section has a schema, the default
 * content shipped with the platform, and field descriptions used to build the
 * admin editor. Text is rendered as plain text, or through the restricted
 * Markdown renderer (no raw HTML) for "markdown" fields.
 */

const text = (max: number) => z.string().trim().max(max, `Maximum ${max} characters`);
const required = (max: number) => text(max).min(1, "Required");
/** Same-site path ("/about") or an https:// / mailto: link. */
export const safeLink = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || (/^\/(?![\/\\])/.test(v) && !/[\s]/.test(v)) || /^https:\/\/[^\s]+$/i.test(v) || /^mailto:[^\s]+$/i.test(v), "Use a site path like /contact, or a full https:// address");

export const FEATURE_ICONS = ["ClipboardList", "FolderKanban", "LineChart", "Sparkles", "ShieldCheck", "Users", "Building2", "MessageSquare", "BookOpen", "Clock"] as const;

export type FieldKind = "text" | "textarea" | "markdown" | "lines" | "boolean" | "select" | "features";
export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  options?: readonly (readonly [string, string])[];
}

export const SECTIONS = {
  branding: {
    title: "Branding",
    description: "Name and tagline shown next to the logo, and the footer line on public pages.",
    schema: z.object({
      siteName: required(60),
      tagline: text(80),
      showTextWithLogo: z.boolean(),
      footerText: text(300),
    }),
    defaults: {
      siteName: "KATDICT",
      tagline: "Service & Project Intelligence",
      showTextWithLogo: true,
      footerText: "Katsina State Directorate of Information and Communication Technology (KATDICT)",
    },
    fields: [
      { name: "siteName", label: "Name beside the logo", kind: "text" },
      { name: "tagline", label: "Tagline beside the logo", kind: "text" },
      { name: "showTextWithLogo", label: "Show the name and tagline next to the logo (turn off if the uploaded logo already contains the name)", kind: "boolean" },
      { name: "footerText", label: "Footer text", kind: "text", hint: "Shown after © and the current year." },
    ],
  },
  announcement: {
    title: "Announcement banner",
    description: "An optional notice shown at the top of every public page (e.g. planned maintenance).",
    schema: z.object({
      enabled: z.boolean(),
      tone: z.enum(["info", "warning", "success"]),
      text: text(300),
      linkLabel: text(60),
      linkUrl: safeLink,
    }),
    defaults: { enabled: false, tone: "info", text: "", linkLabel: "", linkUrl: "" },
    fields: [
      { name: "enabled", label: "Show the banner", kind: "boolean" },
      { name: "tone", label: "Style", kind: "select", options: [["info", "Information (blue)"], ["warning", "Warning (amber)"], ["success", "Good news (green)"]] },
      { name: "text", label: "Message", kind: "text" },
      { name: "linkLabel", label: "Link text (optional)", kind: "text" },
      { name: "linkUrl", label: "Link address (optional)", kind: "text", hint: "A page path such as /contact or a full https:// address." },
    ],
  },
  home: {
    title: "Home page",
    description: "The landing page at /.",
    schema: z.object({
      eyebrow: text(120),
      title: required(160),
      intro: text(600),
      primaryCtaLabel: required(40),
      secondaryCtaLabel: required(40),
      howItWorksTitle: text(80),
      steps: z.array(required(120)).max(10),
      featuresTitle: text(120),
      features: z.array(z.object({ icon: z.enum(FEATURE_ICONS), title: required(80), text: text(300) })).max(9),
    }),
    defaults: {
      eyebrow: "Katsina State Directorate of ICT",
      title: "Service & Project Intelligence Management Platform",
      intro: "One accountable channel for Ministries, Departments and Agencies to request ICT services, follow delivery from submission to acceptance, and give feedback — with statewide intelligence for KATDICT leadership.",
      primaryCtaLabel: "Sign in",
      secondaryCtaLabel: "Register your MDA",
      howItWorksTitle: "How it works",
      steps: ["Register and verify your MDA", "Submit a service request", "KATDICT assesses and approves", "An officer is assigned and delivers", "Your MDA reviews and accepts", "The project is closed with a completion report"],
      featuresTitle: "What the platform provides",
      features: [
        { icon: "ClipboardList", title: "Request ICT services", text: "A guided request wizard with a permanent reference, transparent status tracking and clarification messaging." },
        { icon: "FolderKanban", title: "Accountable delivery", text: "Assigned officers, acknowledged assignments, milestones, change control and formal MDA acceptance before closure." },
        { icon: "LineChart", title: "Delivery intelligence", text: "Service-level tracking, scorecards with published metric definitions, and an early-warning centre." },
        { icon: "Sparkles", title: "AI assistance, human decisions", text: "Classification, quality checks and planning drafts for staff review. AI never approves, assigns or closes work." },
        { icon: "ShieldCheck", title: "Audit and decision trail", text: "Every significant decision is recorded with actor, time, reason and previous state in a tamper-evident log." },
        { icon: "Users", title: "Built for 120 MDAs", text: "Institutional accounts, strict separation between MDAs, and role-based access for every user." },
      ],
    },
    fields: [
      { name: "eyebrow", label: "Small heading above the title", kind: "text" },
      { name: "title", label: "Main title", kind: "text" },
      { name: "intro", label: "Introduction", kind: "textarea" },
      { name: "primaryCtaLabel", label: "Sign-in button text", kind: "text" },
      { name: "secondaryCtaLabel", label: "Registration button text", kind: "text" },
      { name: "howItWorksTitle", label: "Steps box heading", kind: "text" },
      { name: "steps", label: "Steps (one per line)", kind: "lines" },
      { name: "featuresTitle", label: "Features heading", kind: "text" },
      { name: "features", label: "Feature cards", kind: "features", hint: "Leave a card's title empty to remove it." },
    ],
  },
  about: {
    title: "About page",
    description: "The page at /about.",
    schema: z.object({ title: required(120), body: text(20_000) }),
    defaults: {
      title: "About the platform",
      body: `The KATDICT Service & Project Intelligence Management Platform (KATDICT-SPIMP) is the Katsina State Government's central channel through which Ministries, Departments and Agencies (MDAs) request ICT services and projects from the Directorate of Information and Communication Technology.

It records every request from submission to final delivery: assessment, approval, assignment of responsible officers, milestones, deliverables, formal MDA acceptance and closure. Each project keeps a permanent **Digital Project Passport** and a **Decision Trail** showing who decided what, when and why.

KATDICT leadership uses the platform's dashboards, scorecards and early-warning centre to monitor delivery across the State. AI-assisted features help staff classify requests, check completeness and draft plans and reports — but every decision remains with an authorised human officer, and AI can be switched off entirely where external processing is not approved.

## Status of this system

This software has been developed for a controlled pilot. Development completion is distinct from formal government acceptance, security certification and production authorisation, which are granted by the appropriate Katsina State authorities.`,
    },
    fields: [
      { name: "title", label: "Page title", kind: "text" },
      { name: "body", label: "Page content", kind: "markdown" },
    ],
  },
  services: {
    title: "Service catalogue page",
    description: "Heading and introduction for /services. The services themselves are managed in Admin › Service catalogue.",
    schema: z.object({ title: required(120), intro: text(1000) }),
    defaults: {
      title: "ICT service catalogue",
      intro: "Services KATDICT offers to Katsina State MDAs. Service-level targets are indicative and are measured from submission, excluding time spent waiting for information from the MDA.",
    },
    fields: [
      { name: "title", label: "Page title", kind: "text" },
      { name: "intro", label: "Introduction", kind: "textarea" },
    ],
  },
  contact: {
    title: "Contact page",
    description: "The page at /contact. Leave contact fields empty until the official details are confirmed.",
    schema: z.object({
      title: required(120),
      intro: text(5000),
      deskName: text(120),
      address: text(500),
      phone: text(100),
      email: z.union([z.literal(""), z.email("Enter a valid email address")]),
      hours: text(200),
      note: text(5000),
    }),
    defaults: {
      title: "Contact and support",
      intro: "For help with your account, a request or a project, signed-in users should use the project or request message thread so that the conversation is recorded. MDA administrators can also raise a formal complaint from **Feedback & complaints**.",
      deskName: "KATDICT Service Desk",
      address: "",
      phone: "",
      email: "",
      hours: "",
      note: "Never share your password or verification codes. KATDICT staff will never ask for them.",
    },
    fields: [
      { name: "title", label: "Page title", kind: "text" },
      { name: "intro", label: "Introduction", kind: "markdown" },
      { name: "deskName", label: "Service desk name", kind: "text" },
      { name: "address", label: "Address", kind: "textarea" },
      { name: "phone", label: "Telephone", kind: "text" },
      { name: "email", label: "Support email", kind: "text" },
      { name: "hours", label: "Opening hours", kind: "text", hint: "e.g. Monday–Friday, 8:00–16:00" },
      { name: "note", label: "Closing note", kind: "markdown" },
    ],
  },
  privacy: {
    title: "Privacy notice",
    description: "The page at /privacy. Have the final text approved by the State's legal/data-protection officers.",
    schema: z.object({ title: required(120), subtitle: text(300), body: text(30_000) }),
    defaults: {
      title: "Privacy notice",
      subtitle: "Draft notice for review by KATDICT and the State's legal/data-protection officers before production use.",
      body: `## What we collect

Official contact details of MDA representatives and staff (name, official email, telephone, designation), institutional profile information, the content of service requests and project records, uploaded documents, and security logs (sign-in times, IP address, browser type) needed to protect accounts.

## Why we use it

To deliver and account for ICT services to Katsina State MDAs, to communicate about requests and projects, to produce performance and audit reports, and to secure the platform.

## Who can see it

Each MDA can only see its own records. KATDICT staff see records according to their role. Auditors have read-only access for oversight. Internal KATDICT notes are never shown to MDA users.

## AI processing

AI-assisted features are disabled unless KATDICT has approved an AI provider and the related data-handling arrangements. When enabled, only the minimum record content needed for a requested analysis is sent, and the platform does not authorise use of government data for model training.

## Retention

Project and audit records are kept as official records according to the retention periods configured by KATDICT. Notifications and security logs are retained for shorter periods.

## Your rights and contact

To correct your information or raise a privacy concern, contact KATDICT support via the [Contact page](/contact).`,
    },
    fields: [
      { name: "title", label: "Page title", kind: "text" },
      { name: "subtitle", label: "Subtitle", kind: "text" },
      { name: "body", label: "Notice text", kind: "markdown" },
    ],
  },
} as const satisfies Record<string, { title: string; description: string; schema: z.ZodType; defaults: unknown; fields: readonly FieldDef[] }>;

export type SectionKey = keyof typeof SECTIONS;
export type SectionContent<K extends SectionKey> = z.infer<(typeof SECTIONS)[K]["schema"]>;
export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[];

export function isSectionKey(k: string): k is SectionKey {
  return k in SECTIONS;
}

/** Converts submitted form fields into the section's shape before validation. */
export function contentFromForm(key: SectionKey, fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SECTIONS[key].fields as readonly FieldDef[]) {
    const raw = fd.get(f.name);
    switch (f.kind) {
      case "boolean":
        out[f.name] = raw === "on" || raw === "true";
        break;
      case "lines":
        out[f.name] = String(raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        break;
      case "features": {
        const items: unknown[] = [];
        for (let i = 0; i < 9; i++) {
          const title = String(fd.get(`${f.name}.${i}.title`) ?? "").trim();
          if (!title) continue;
          const icon = String(fd.get(`${f.name}.${i}.icon`) ?? "");
          items.push({ title, text: String(fd.get(`${f.name}.${i}.text`) ?? "").trim(), icon: (FEATURE_ICONS as readonly string[]).includes(icon) ? icon : FEATURE_ICONS[0] });
        }
        out[f.name] = items;
        break;
      }
      default:
        out[f.name] = String(raw ?? "").replace(/\r\n/g, "\n");
    }
  }
  return out;
}

/** Raster formats only (no SVG: it can carry script). Detected from file signatures. */
export function sniffLogo(b: Uint8Array): string | null {
  const at = (sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

