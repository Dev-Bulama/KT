import { prisma } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import { escalateOverdueAcknowledgements } from "@/modules/projects/assignments";
import { escalationRecipients, projectTeamIds } from "@/modules/projects/service";
import { getSetting } from "@/modules/settings/service";

/**
 * Scheduled escalation rules (idempotent via notification dedupe keys):
 *  - unacknowledged assignments → department head + operations
 *  - deadlines approaching / overdue projects → project team (+ escalation for overdue)
 *  - clarification requests unanswered beyond the configured days → MDA admins + assessor
 */
export async function runEscalations(now = new Date()) {
  const ack = await escalateOverdueAcknowledgements(now);
  const warnDays = await getSetting("workflow.deadlineWarningDays");
  const clarDays = await getSetting("workflow.clarificationEscalationDays");
  const day = now.toISOString().slice(0, 10);

  const approaching = await prisma.project.findMany({ where: { plannedEndDate: { gte: now, lte: new Date(now.getTime() + warnDays * 86400000) }, status: { notIn: ["CLOSED", "CANCELLED", "ACCEPTED", "AWAITING_MDA_ACCEPTANCE"] } }, select: { id: true, reference: true, title: true, plannedEndDate: true } });
  for (const p of approaching) {
    await prisma.$transaction(async (tx) => notify(tx, { userIds: await projectTeamIds(tx, p.id), type: "project.deadline_approaching", title: `Deadline approaching: ${p.reference}`, body: `"${p.title}" is due on ${p.plannedEndDate!.toISOString().slice(0, 10)}.`, link: `/projects/${p.id}`, dedupeKey: `deadline:${p.id}:${p.plannedEndDate!.toISOString().slice(0, 10)}` }));
  }
  const overdue = await prisma.project.findMany({ where: { plannedEndDate: { lt: now }, status: { notIn: ["CLOSED", "CANCELLED", "ACCEPTED", "AWAITING_MDA_ACCEPTANCE"] } }, select: { id: true, reference: true, title: true, departmentId: true } });
  for (const p of overdue) {
    // Weekly reminder cadence for overdue projects.
    const week = Math.floor(now.getTime() / (7 * 86400000));
    await prisma.$transaction(async (tx) => notify(tx, { userIds: [...(await projectTeamIds(tx, p.id)), ...(await escalationRecipients(tx, p.departmentId))], type: "project.overdue", title: `Project overdue: ${p.reference}`, body: `"${p.title}" has passed its planned completion date.`, link: `/projects/${p.id}`, dedupeKey: `overdue:${p.id}:w${week}` }));
  }
  const waiting = await prisma.serviceRequest.findMany({
    where: { status: "NEEDS_INFORMATION" },
    select: { id: true, reference: true, mdaId: true, assessorId: true, createdById: true, history: { where: { toStatus: "NEEDS_INFORMATION" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
  });
  let clar = 0;
  for (const r of waiting) {
    const since = r.history[0]?.createdAt;
    if (!since || now.getTime() - since.getTime() < clarDays * 86400000) continue;
    clar++;
    await prisma.$transaction(async (tx) => {
      const admins = await tx.user.findMany({ where: { membership: { mdaId: r.mdaId }, roles: { some: { role: { key: "MDA_ADMIN" } } }, status: "ACTIVE" }, select: { id: true } });
      await notify(tx, { userIds: [r.createdById, ...admins.map((a) => a.id)], type: "escalation.clarification_overdue", title: `Response overdue: ${r.reference}`, body: `KATDICT is still waiting for the information requested on ${since.toISOString().slice(0, 10)}. The request cannot progress until you respond.`, link: `/requests/${r.id}`, dedupeKey: `clar:${r.id}:${day}` });
      await notify(tx, { userIds: r.assessorId ? [r.assessorId] : await usersWithPermission(tx, "request.triage"), type: "escalation.clarification_overdue", title: `MDA response overdue: ${r.reference}`, body: `No MDA response for more than ${clarDays} days.`, link: `/requests/${r.id}`, email: false, dedupeKey: `clar-k:${r.id}:${day}` });
    });
  }
  await audit(null, { actorId: null, action: "system.escalations_run", entityType: "System", after: { ack, approaching: approaching.length, overdue: overdue.length, clarification: clar } });
  return { ack, approaching: approaching.length, overdue: overdue.length, clarification: clar };
}

/** Health probe helper: database round-trip in milliseconds. */
export async function measureDbLatency(): Promise<number> {
  const t0 = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  return Math.round(performance.now() - t0);
}

export function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600_000);
}
