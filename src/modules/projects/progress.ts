/**
 * Project progress calculation (pure, documented, configurable via the
 * `progress.method` setting). Officers cannot type a percentage: progress is
 * always derived from milestone and task records.
 *
 * WEIGHTED_MILESTONES  Σ weight(completed milestones) / Σ weight(non-cancelled milestones)
 * WEIGHTED_TASKS       Σ weight(done tasks) / Σ weight(non-cancelled tasks)
 * HYBRID (default)     Σ over non-cancelled milestones of weight × credit, where credit is 1 for a
 *                      completed milestone, otherwise the weighted share of its done tasks (0 if it
 *                      has none), divided by Σ weight. Falls back to WEIGHTED_TASKS when there are
 *                      no milestones.
 * The result is rounded down, and is 100 only when every counted item is complete.
 */

export type ProgressMethod = "WEIGHTED_MILESTONES" | "WEIGHTED_TASKS" | "HYBRID";

export interface ProgressTask {
  weight: number;
  status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  milestoneId: string | null;
}

export interface ProgressMilestone {
  id: string;
  weight: number;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
}

function pct(done: number, total: number): number {
  if (total <= 0) return 0;
  const v = Math.floor((done / total) * 100);
  return done < total ? Math.min(v, 99) : 100;
}

export function calculateProgress(method: ProgressMethod, milestones: ProgressMilestone[], tasks: ProgressTask[]): number {
  const liveTasks = tasks.filter((t) => t.status !== "CANCELLED");
  const liveMs = milestones.filter((m) => m.status !== "CANCELLED");
  const taskPct = () => pct(liveTasks.filter((t) => t.status === "DONE").reduce((s, t) => s + t.weight, 0), liveTasks.reduce((s, t) => s + t.weight, 0));

  if (method === "WEIGHTED_TASKS") return taskPct();
  if (method === "WEIGHTED_MILESTONES") {
    return pct(liveMs.filter((m) => m.status === "COMPLETED").reduce((s, m) => s + m.weight, 0), liveMs.reduce((s, m) => s + m.weight, 0));
  }
  if (liveMs.length === 0) return taskPct();
  const total = liveMs.reduce((s, m) => s + m.weight, 0);
  let earned = 0;
  for (const m of liveMs) {
    if (m.status === "COMPLETED") {
      earned += m.weight;
      continue;
    }
    const mt = liveTasks.filter((t) => t.milestoneId === m.id);
    const tw = mt.reduce((s, t) => s + t.weight, 0);
    const dw = mt.filter((t) => t.status === "DONE").reduce((s, t) => s + t.weight, 0);
    // An incomplete milestone never earns full credit even if all its tasks are done.
    earned += tw > 0 ? m.weight * Math.min(dw / tw, 0.99) : 0;
  }
  return pct(earned, total);
}
