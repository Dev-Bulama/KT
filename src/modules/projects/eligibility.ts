/**
 * Assignment eligibility rules (pure). Used by the assignment service and by
 * AI/rule-based assignment recommendations.
 */
export interface Candidate {
  id: string;
  status: string;
  userType: string;
  departmentId: string | null;
  permissions: ReadonlySet<string>;
  activeAssignments: number;
  maxConcurrentProjects: number;
}

export interface EligibilityContext {
  /** When assigning as a department head, assignees must belong to this department. */
  restrictToDepartmentId?: string | null;
  role: "PROJECT_MANAGER" | "OFFICER";
  /** Allow exceeding capacity with an explicit acknowledgement. */
  allowOverCapacity?: boolean;
}

export function checkAssignmentEligibility(c: Candidate, ctx: EligibilityContext): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (c.userType !== "KATDICT_STAFF") reasons.push("Only KATDICT staff can be assigned to projects.");
  if (c.status !== "ACTIVE") reasons.push("The user account is not active.");
  if (!c.permissions.has("project.update")) reasons.push("The user does not hold a delivery role (project.update).");
  if (ctx.role === "PROJECT_MANAGER" && !c.permissions.has("project.completion.submit") && !c.permissions.has("project.manage")) {
    reasons.push("Project managers must be able to submit completion evidence.");
  }
  if (ctx.restrictToDepartmentId && c.departmentId !== ctx.restrictToDepartmentId) reasons.push("Department heads can only assign members of their own department.");
  if (!ctx.allowOverCapacity && c.activeAssignments >= c.maxConcurrentProjects) {
    reasons.push(`The officer is at capacity (${c.activeAssignments}/${c.maxConcurrentProjects} active projects).`);
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Detects whether adding edge task→dependsOn would create a cycle. */
export function wouldCreateCycle(edges: { taskId: string; dependsOnId: string }[], taskId: string, dependsOnId: string): boolean {
  if (taskId === dependsOnId) return true;
  const adj = new Map<string, string[]>();
  for (const e of [...edges, { taskId, dependsOnId }]) {
    adj.set(e.taskId, [...(adj.get(e.taskId) ?? []), e.dependsOnId]);
  }
  const seen = new Set<string>();
  const stack = [dependsOnId];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === taskId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(adj.get(n) ?? []));
  }
  return false;
}
