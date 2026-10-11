import { z } from "zod";
import type { Priority } from "@/generated/prisma/enums";
import { PRIORITY_RANK } from "@/modules/approvals/policy";

/**
 * Default priority rules configured per service definition (JSON).
 * Each rule raises the suggested priority when its condition matches; the
 * highest matching priority wins and never goes below the service default.
 *
 * Example: [{"when":{"urgency":"CRITICAL"},"priority":"CRITICAL"},
 *           {"when":{"estimatedUsersGte":1000},"priority":"HIGH"},
 *           {"when":{"hasLegalConsiderations":true},"priority":"HIGH"}]
 */
export const priorityRuleSchema = z.object({
  when: z
    .object({
      urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      estimatedUsersGte: z.number().int().nonnegative().optional(),
      hasLegalConsiderations: z.boolean().optional(),
    })
    .strict(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
});
export const priorityRulesSchema = z.array(priorityRuleSchema).max(20);
export type PriorityRule = z.infer<typeof priorityRuleSchema>;

export interface PriorityFacts {
  urgency: Priority;
  estimatedUsers: number | null;
  legalConsiderations: string | null;
}

export function suggestPriority(defaultPriority: Priority, rulesJson: unknown, facts: PriorityFacts): { priority: Priority; reasons: string[] } {
  const parsed = priorityRulesSchema.safeParse(rulesJson ?? []);
  let best: Priority = defaultPriority;
  const reasons: string[] = [`Service default priority: ${defaultPriority}`];
  if (!parsed.success) return { priority: best, reasons: [...reasons, "Priority rules are invalid and were ignored"] };
  for (const rule of parsed.data) {
    const w = rule.when;
    const conds: boolean[] = [];
    if (w.urgency) conds.push(facts.urgency === w.urgency);
    if (w.estimatedUsersGte !== undefined) conds.push((facts.estimatedUsers ?? 0) >= w.estimatedUsersGte);
    if (w.hasLegalConsiderations !== undefined) conds.push(!!facts.legalConsiderations?.trim() === w.hasLegalConsiderations);
    if (conds.length && conds.every(Boolean)) {
      reasons.push(`Rule matched (${JSON.stringify(w)}) → ${rule.priority}`);
      if (PRIORITY_RANK[rule.priority] > PRIORITY_RANK[best]) best = rule.priority;
    }
  }
  return { priority: best, reasons };
}
