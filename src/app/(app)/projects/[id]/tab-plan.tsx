import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { Alert, EmptyState } from "@/components/ui/misc";
import { formatDate, cn } from "@/lib/utils";
import { getSetting, SETTINGS } from "@/modules/settings/service";
import { adoptPlanAction, dependencyAction, dismissPlanAction, milestoneAction, milestoneStatusAction, suggestPlanAction, taskAction, taskStatusAction } from "../actions";
import type { TabProps } from "./types";

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;

export async function PlanTab({ p, internal, canWork, sp }: TabProps) {
  const view = sp.view ?? "list";
  const method = await getSetting("progress.method");
  const tasks = p.tasks ?? [];
  const team = internal ? [...(p.projectManager ? [p.projectManager] : []), ...p.assignments.filter((a) => ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"].includes(a.status) && a.assignee.id !== p.projectManagerId).map((a) => a.assignee)] : [];
  const draft = canWork ? await prisma.aIRecommendation.findFirst({ where: { feature: "planning", entityType: "Project", entityId: p.id, status: "PROPOSED" }, orderBy: { createdAt: "desc" } }) : null;
  const plan = draft ? ((draft.payload as { data: { phases: { name: string; milestones: { title: string; weight: number; durationDays: number; tasks: string[] }[] }[]; risks: string[]; requiredSkills: string[]; testingRequirements: string[]; documentationRequirements: string[]; dependencies: string[] } }).data) : null;
  const now = new Date();
  const base = `/projects/${p.id}?tab=plan`;
  const hidden = <input type="hidden" name="projectId" value={p.id} />;

  // Timeline bounds
  const dated = p.milestones.filter((m) => m.dueDate);
  const start = p.startDate ?? p.assignedAt ?? p.createdAt;
  const end = new Date(Math.max(...dated.map((m) => m.dueDate!.getTime()), (p.plannedEndDate ?? now).getTime(), start.getTime() + 86400000));
  const span = end.getTime() - start.getTime();
  const pos = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - start.getTime()) / span) * 100));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 text-sm" aria-label="Plan view">
          {["list", "board", "timeline"].map((v) => <Link key={v} href={`${base}&view=${v}`} aria-current={view === v ? "page" : undefined} className={cn("rounded-md border px-3 py-1 capitalize no-underline", view === v ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-ink")}>{v}</Link>)}
        </nav>
        <p className="text-xs text-muted">Progress method: <strong>{method.replace(/_/g, " ").toLowerCase()}</strong> — {SETTINGS["progress.method"].description.split(". ").find((s) => s.startsWith(method)) ?? ""}</p>
      </div>

      {view === "list" && (
        p.milestones.length === 0 ? <EmptyState title="No milestones yet" description={canWork ? "Add milestones below or ask the planning assistant for a draft." : "The project team has not published milestones yet."} /> : (
          <div className="space-y-4">
            {p.milestones.map((m) => {
              const mt = tasks.filter((t) => t.milestoneId === m.id);
              const overdue = m.dueDate && m.dueDate < now && !["COMPLETED", "CANCELLED"].includes(m.status);
              return (
                <Card key={m.id}>
                  <CardHeader title={<span className="flex flex-wrap items-center gap-2">{m.title}<StatusBadge status={m.status} />{overdue && <Badge tone="danger">Overdue</Badge>}{internal && !m.visibleToMda && <Badge tone="warning">Internal</Badge>}</span>} description={`Due ${formatDate(m.dueDate)} · weight ${m.weight}${m.completedAt ? ` · completed ${formatDate(m.completedAt)}` : ""}`}
                    actions={canWork && m.status !== "COMPLETED" && m.status !== "CANCELLED" ? (
                      <>
                        {m.status === "PENDING" && <ActionForm inline action={milestoneStatusAction} submitLabel="Start" submitVariant="secondary">{hidden}<input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="status" value="IN_PROGRESS" /></ActionForm>}
                        <ActionForm inline action={milestoneStatusAction} submitLabel="Mark complete" submitVariant="accent">{hidden}<input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="status" value="COMPLETED" /></ActionForm>
                      </>
                    ) : undefined} />
                  {internal && (
                    <CardBody>
                      {mt.length === 0 ? <p className="text-sm text-muted">No tasks.</p> : (
                        <ul className="divide-y divide-line text-sm">
                          {mt.map((t) => (
                            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                              <span>{t.title} <span className="text-xs text-muted">· {t.assignee?.name ?? "Unassigned"} · due {formatDate(t.dueDate)}{t.dependsOn.length ? ` · depends on ${t.dependsOn.length}` : ""}</span></span>
                              {canWork ? (
                                <ActionForm inline action={taskStatusAction} submitLabel="Update" submitVariant="secondary">{hidden}<input type="hidden" name="taskId" value={t.id} />
                                  <Select name="status" defaultValue={t.status} aria-label={`Status of ${t.title}`} className="h-8 w-36">{TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}</Select>
                                </ActionForm>
                              ) : <StatusBadge status={t.status} />}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardBody>
                  )}
                </Card>
              );
            })}
            {internal && tasks.filter((t) => !t.milestoneId).length > 0 && (
              <Card><CardHeader title="Tasks without a milestone" /><CardBody><ul className="space-y-1 text-sm">{tasks.filter((t) => !t.milestoneId).map((t) => <li key={t.id} className="flex justify-between"><span>{t.title}</span><StatusBadge status={t.status} /></li>)}</ul></CardBody></Card>
            )}
          </div>
        )
      )}

      {view === "board" && internal && (
        <div className="grid gap-3 md:grid-cols-5">
          {TASK_STATUSES.map((s) => (
            <div key={s} className="rounded-[var(--radius-card)] border border-line bg-white">
              <p className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{s.replace("_", " ")} ({tasks.filter((t) => t.status === s).length})</p>
              <ul className="space-y-2 p-2">
                {tasks.filter((t) => t.status === s).map((t) => (
                  <li key={t.id} className={cn("rounded-md border p-2 text-sm", t.dueDate && t.dueDate < now && s !== "DONE" && s !== "CANCELLED" ? "border-red-200 bg-danger-100/40" : "border-line")}>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-muted">{t.assignee?.name ?? "Unassigned"} · {formatDate(t.dueDate)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {view === "board" && !internal && <Alert tone="info">The task board is internal to the KATDICT team. Milestones are shown in the list and timeline views.</Alert>}

      {view === "timeline" && (
        <Card><CardHeader title="Milestone timeline" description={`${formatDate(start)} – ${formatDate(end)}`} /><CardBody>
          {dated.length === 0 ? <p className="text-sm text-muted">No dated milestones.</p> : (
            <div className="space-y-2">
              <div className="relative h-4 text-[10px] text-muted"><span className="absolute left-0">{formatDate(start)}</span><span className="absolute right-0">{formatDate(end)}</span></div>
              {p.milestones.map((m) => (
                <div key={m.id} className="grid grid-cols-[minmax(120px,220px)_1fr] items-center gap-3 text-sm">
                  <span className="truncate" title={m.title}>{m.title}</span>
                  <div className="relative h-6 rounded bg-slate-100">
                    <div className="absolute top-0 h-full w-px bg-danger-700" style={{ left: `${pos(now)}%` }} title="Today" aria-hidden />
                    {m.dueDate && <span className={cn("absolute top-1 h-4 w-4 -translate-x-1/2 rotate-45 rounded-sm", m.status === "COMPLETED" ? "bg-accent-600" : m.dueDate < now ? "bg-danger-700" : "bg-navy-700")} style={{ left: `${pos(m.dueDate)}%` }} title={`${m.title}: ${formatDate(m.dueDate)} (${m.status})`} />}
                  </div>
                </div>
              ))}
              <p className="pt-2 text-xs text-muted">◆ green = completed, red = overdue, navy = upcoming. Vertical red line = today.</p>
            </div>
          )}
        </CardBody></Card>
      )}

      {canWork && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title="Add milestone" /><CardBody>
            <ActionForm action={milestoneAction} submitLabel="Add milestone" resetOnSuccess>
              {hidden}
              <Field label="Title" name="title" required><Input /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Due date" name="dueDate"><Input type="date" /></Field><Field label="Weight" name="weight" hint="Relative contribution to progress"><Input type="number" min={1} max={100} defaultValue={1} /></Field></div>
              <Field label="Description" name="description"><Textarea rows={2} /></Field>
              <Checkbox name="visibleToMda" label="Visible to the MDA" defaultChecked />
            </ActionForm>
          </CardBody></Card>
          <Card><CardHeader title="Add task" /><CardBody>
            <ActionForm action={taskAction} submitLabel="Add task" resetOnSuccess>
              {hidden}
              <Field label="Title" name="title" required><Input /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Milestone" name="milestoneId"><Select defaultValue=""><option value="">— None —</option>{p.milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</Select></Field>
                <Field label="Assignee" name="assigneeId"><Select defaultValue=""><option value="">— Unassigned —</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
                <Field label="Due date" name="dueDate"><Input type="date" /></Field>
                <Field label="Weight" name="weight"><Input type="number" min={1} max={100} defaultValue={1} /></Field>
              </div>
            </ActionForm>
            {tasks.length > 1 && (
              <div className="mt-6 border-t border-line pt-4">
                <ActionForm action={dependencyAction} submitLabel="Add dependency" resetOnSuccess>
                  {hidden}
                  <p className="text-sm font-medium">Task dependency</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Task" name="taskId" required><Select defaultValue="">{[<option key="" value="">—</option>, ...tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)]}</Select></Field>
                    <Field label="Depends on" name="dependsOnId" required><Select defaultValue="">{[<option key="" value="">—</option>, ...tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)]}</Select></Field>
                  </div>
                </ActionForm>
              </div>
            )}
          </CardBody></Card>
          <Card className="lg:col-span-2"><CardHeader title="Planning assistant" description="Generates a DRAFT work breakdown. Nothing changes until you adopt it." /><CardBody className="space-y-4">
            <ActionForm action={suggestPlanAction} submitLabel="Generate draft plan" submitVariant="secondary">{hidden}</ActionForm>
            {plan && draft && (
              <div className="space-y-3 rounded-md border border-dashed border-navy-700/40 bg-navy-50/50 p-4 text-sm">
                <p className="text-xs font-semibold text-navy-800">{draft.source === "ai" ? "AI-generated draft — requires approval" : "Rule-based template draft — requires approval"}</p>
                {plan.phases.map((ph, i) => (
                  <div key={i}><p className="font-semibold">{ph.name}</p>
                    <ul className="ml-4 list-disc">{ph.milestones.map((m, j) => <li key={j}>{m.title} <span className="text-muted">(weight {m.weight}, ~{m.durationDays} days)</span>: {m.tasks.join("; ")}</li>)}</ul>
                  </div>
                ))}
                <p><span className="text-muted">Risks:</span> {plan.risks.join("; ")}</p>
                <p><span className="text-muted">Skills:</span> {plan.requiredSkills.join(", ")}</p>
                <p><span className="text-muted">Testing:</span> {plan.testingRequirements.join("; ")}</p>
                <p><span className="text-muted">Documentation:</span> {plan.documentationRequirements.join("; ")}</p>
                <div className="flex flex-wrap gap-2">
                  <ActionForm inline action={adoptPlanAction} submitLabel="Adopt as milestones & tasks" submitVariant="accent" confirm="Create these milestones and tasks on the project?">{hidden}<input type="hidden" name="recommendationId" value={draft.id} /></ActionForm>
                  <ActionForm inline action={dismissPlanAction} submitLabel="Dismiss" submitVariant="ghost">{hidden}<input type="hidden" name="recommendationId" value={draft.id} /></ActionForm>
                </div>
              </div>
            )}
          </CardBody></Card>
        </div>
      )}
    </div>
  );
}
