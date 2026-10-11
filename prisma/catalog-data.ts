/**
 * Initial configuration data. These are DEFAULTS for administrators to adjust
 * in Admin › Service catalog / Departments. They are not an officially
 * approved KATDICT organisational structure.
 */

export const DEFAULT_DEPARTMENTS = [
  { code: "SWD", name: "Software & Applications", description: "Software, web, mobile and portal development; systems integration." },
  { code: "INF", name: "Infrastructure & Networks", description: "Hardware, networks, connectivity, cloud and data centre services." },
  { code: "SEC", name: "Cybersecurity", description: "Security assessments, incident support and audits." },
  { code: "DAI", name: "Data, Analytics & AI", description: "Databases, analytics, business intelligence, AI and GIS." },
  { code: "DTA", name: "Digital Transformation & Advisory", description: "Consulting, policy and standards, procurement evaluation, project recovery, research." },
  { code: "CAP", name: "Capacity Building", description: "ICT training and capacity development." },
  { code: "SUP", name: "Technical Support", description: "Maintenance, support, records management and continuity." },
] as const;

type Dept = (typeof DEFAULT_DEPARTMENTS)[number]["code"];

export interface CategorySeed {
  code: string;
  name: string;
  description: string;
  dept: Dept;
  sla: [number, number, number]; // triage hours, assessment days, delivery days
  deliverables: string[];
  checklist: string[];
  defaultPriority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  rules?: unknown[];
}

const SOFTWARE_DELIVERABLES = ["Requirements specification", "Solution design document", "Deployed application", "Test report", "User manual", "Handover documentation"];
const SOFTWARE_CHECKLIST = ["Business owner identified", "Requirements are clear", "Existing systems reviewed", "Data protection considered", "Hosting approach identified", "Budget/resources confirmed"];
const URGENT_RULES = [{ when: { urgency: "CRITICAL" }, priority: "CRITICAL" }, { when: { urgency: "HIGH" }, priority: "HIGH" }, { when: { estimatedUsersGte: 1000 }, priority: "HIGH" }, { when: { hasLegalConsiderations: true }, priority: "HIGH" }];

export const SERVICE_CATEGORIES: CategorySeed[] = [
  { code: "SOFTWARE_DEV", name: "Software Development", description: "Custom software solutions for MDA business processes.", dept: "SWD", sla: [48, 10, 120], deliverables: SOFTWARE_DELIVERABLES, checklist: SOFTWARE_CHECKLIST },
  { code: "WEB_APP_DEV", name: "Web Application Development", description: "Browser-based applications and online services.", dept: "SWD", sla: [48, 10, 90], deliverables: SOFTWARE_DELIVERABLES, checklist: SOFTWARE_CHECKLIST },
  { code: "MOBILE_APP_DEV", name: "Mobile Application Development", description: "Android/iOS applications for staff or citizens.", dept: "SWD", sla: [48, 10, 120], deliverables: SOFTWARE_DELIVERABLES, checklist: SOFTWARE_CHECKLIST },
  { code: "SYSTEMS_INTEGRATION", name: "Enterprise Systems Integration", description: "Integrating existing government systems and data exchange.", dept: "SWD", sla: [48, 15, 120], deliverables: ["Integration design", "Interface specifications", "Integrated systems", "Test report", "Operations guide"], checklist: ["Systems and owners identified", "Data formats documented", "Security of interfaces considered"] },
  { code: "DATABASE_ADMIN", name: "Database Administration", description: "Database design, tuning, backup and administration.", dept: "DAI", sla: [24, 5, 30], deliverables: ["Assessment report", "Configuration changes", "Backup/restore verification"], checklist: ["Database inventory provided", "Backup status known"] },
  { code: "DATA_ANALYTICS_BI", name: "Data Analytics and Business Intelligence", description: "Dashboards, reporting and analytics.", dept: "DAI", sla: [48, 10, 60], deliverables: ["Data inventory", "Dashboard/reports", "Data dictionary", "User guide"], checklist: ["Data sources identified", "Indicators defined", "Data owners identified"] },
  { code: "AI_AUTOMATION", name: "Artificial Intelligence and Automation", description: "AI-assisted processes and workflow automation.", dept: "DAI", sla: [48, 15, 120], deliverables: ["Feasibility assessment", "Solution design", "Pilot implementation", "Evaluation report"], checklist: ["Use case defined", "Data availability confirmed", "Risks and oversight considered"] },
  { code: "ICT_TRAINING", name: "ICT Capacity Building and Training", description: "Training programmes for MDA staff.", dept: "CAP", sla: [48, 7, 45], deliverables: ["Training needs assessment", "Training materials", "Attendance records", "Training report"], checklist: ["Participants identified", "Venue/equipment confirmed"] },
  { code: "HARDWARE_DEPLOYMENT", name: "Computer Hardware Deployment", description: "Specification, deployment and configuration of computer equipment.", dept: "INF", sla: [24, 7, 45], deliverables: ["Specification", "Installation report", "Asset register update"], checklist: ["Quantities confirmed", "Site readiness confirmed"] },
  { code: "NETWORK_INFRA", name: "Network Infrastructure", description: "LAN/WAN design, installation and upgrade.", dept: "INF", sla: [24, 10, 60], deliverables: ["Site survey report", "Network design", "Installation and test report", "As-built documentation"], checklist: ["Site survey possible", "Power availability confirmed"] },
  { code: "INTERNET_CONNECTIVITY", name: "Internet Connectivity and Infrastructure", description: "Internet access, bandwidth and connectivity infrastructure.", dept: "INF", sla: [24, 7, 45], deliverables: ["Connectivity assessment", "Installed link", "SLA/acceptance test report"], checklist: ["Number of users", "Current provider/bandwidth"] },
  { code: "CYBERSECURITY_ASSESSMENT", name: "Cybersecurity Assessment", description: "Vulnerability and security posture assessments.", dept: "SEC", sla: [24, 7, 30], deliverables: ["Scope and rules of engagement", "Assessment report", "Remediation plan"], checklist: ["Systems in scope listed", "Authorisation letter obtained"], defaultPriority: "HIGH" },
  { code: "SECURITY_INCIDENT", name: "Security Incident Support", description: "Response support for suspected or actual security incidents.", dept: "SEC", sla: [4, 2, 14], deliverables: ["Incident report", "Containment actions", "Lessons learned"], checklist: ["Incident time and systems identified", "Evidence preserved"], defaultPriority: "CRITICAL" },
  { code: "IT_INFRA_AUDIT", name: "IT Infrastructure Audit", description: "Audit of ICT assets, configurations and practices.", dept: "SEC", sla: [48, 10, 45], deliverables: ["Audit plan", "Audit report", "Recommendations"], checklist: ["Asset lists available", "Access arrangements"] },
  { code: "CLOUD_MIGRATION", name: "Cloud Services and Migration", description: "Cloud adoption, hosting and migration.", dept: "INF", sla: [48, 15, 90], deliverables: ["Cloud readiness assessment", "Migration plan", "Migrated workloads", "Operations runbook"], checklist: ["Workloads inventoried", "Data residency considered"] },
  { code: "DIGITAL_TRANSFORMATION", name: "Digital Transformation Consulting", description: "Process redesign and digital strategy advisory.", dept: "DTA", sla: [48, 15, 90], deliverables: ["Current-state assessment", "Roadmap", "Recommendations report"], checklist: ["Executive sponsor identified", "Processes in scope listed"] },
  { code: "ICT_POLICY_ADVISORY", name: "ICT Policy and Standards Advisory", description: "ICT policies, standards and guidelines.", dept: "DTA", sla: [48, 15, 60], deliverables: ["Draft policy/standard", "Consultation record", "Final document"], checklist: ["Policy objective defined", "Stakeholders identified"] },
  { code: "IT_PROJECT_RECOVERY", name: "IT Project Recovery", description: "Assessment and recovery of troubled ICT projects.", dept: "DTA", sla: [24, 10, 60], deliverables: ["Project health assessment", "Recovery plan", "Recovery status report"], checklist: ["Contract and documents available", "Vendor contacts available"], defaultPriority: "HIGH" },
  { code: "MAINTENANCE_SUPPORT", name: "System Maintenance and Technical Support", description: "Corrective and preventive maintenance and support.", dept: "SUP", sla: [8, 3, 14], deliverables: ["Support ticket resolution report", "Maintenance log"], checklist: ["System and fault described"] },
  { code: "DR_BCP", name: "Disaster Recovery and Business Continuity", description: "Backup, recovery and continuity planning.", dept: "INF", sla: [48, 10, 90], deliverables: ["Business impact analysis", "DR plan", "DR test report"], checklist: ["Critical systems identified", "Recovery objectives discussed"] },
  { code: "RECORDS_MANAGEMENT", name: "Digital Records and Document Management", description: "Electronic records, archives and document workflows.", dept: "SUP", sla: [48, 10, 90], deliverables: ["Records assessment", "Configured EDMS", "User manual", "Training records"], checklist: ["Record types identified", "Retention rules known"] },
  { code: "GOV_PORTAL", name: "Government Portal Development", description: "Websites and portals for MDAs.", dept: "SWD", sla: [48, 10, 60], deliverables: ["Content plan", "Portal design", "Live portal", "Content management guide"], checklist: ["Content owner identified", "Domain/hosting arrangements"] },
  { code: "GIS", name: "Geographic Information Systems", description: "Mapping, spatial data and GIS applications.", dept: "DAI", sla: [48, 15, 90], deliverables: ["Spatial data inventory", "GIS application/maps", "Metadata", "User guide"], checklist: ["Spatial data sources identified", "Coordinate standards agreed"] },
  { code: "PROCUREMENT_EVALUATION", name: "Procurement Technical Evaluation", description: "Technical specifications and bid evaluation support.", dept: "DTA", sla: [24, 5, 21], deliverables: ["Technical specification review", "Evaluation report"], checklist: ["Procurement documents provided", "Timeline known"], defaultPriority: "HIGH" },
  { code: "ICT_RESEARCH", name: "ICT Research and Innovation", description: "Research, pilots and innovation initiatives.", dept: "DTA", sla: [72, 15, 120], deliverables: ["Research proposal", "Findings report"], checklist: ["Research question defined"] },
  { code: "OTHER", name: "Other ICT Services", description: "ICT services not covered by other categories.", dept: "DTA", sla: [48, 10, 60], deliverables: ["Agreed deliverables"], checklist: ["Need clearly described"] },
];

export const DEFAULT_RULES = URGENT_RULES;

/**
 * Default approval policy. The thresholds are PLACEHOLDERS chosen for the demo
 * and must be confirmed by KATDICT management before production use.
 */
export const DEFAULT_POLICY = {
  name: "Standard approval",
  description: "Technical review, departmental approval, and executive approval for high-priority, high-cost or long-duration work. Thresholds are placeholders pending KATDICT confirmation.",
  steps: [
    { name: "Technical review", requiredPermission: "request.approve.technical" },
    { name: "Departmental approval", requiredPermission: "request.approve.department" },
    { name: "Executive approval", requiredPermission: "request.approve.executive", minPriority: "HIGH" as const, minEstimatedCostNgn: 50_000_000, minEstimatedEffortDays: 90 },
  ],
};
