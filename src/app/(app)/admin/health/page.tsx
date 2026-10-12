import { storageDriverKind } from "@/modules/files/storage";
import { requirePageActor } from "@/modules/auth/current";
import { prisma } from "@/lib/db";
import { getAIProvider } from "@/modules/ai/provider";
import { hoursAgo, measureDbLatency } from "@/modules/quality/escalations";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "System health" };

export default async function Health() {
  await requirePageActor("system.health.view");
  const since = hoursAgo(24);
  const dbMs = await measureDbLatency();
  const [users, sessions, failedLogins, locked, outboxDead, ai, aiErrors, audit] = await Promise.all([
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: hoursAgo(0) } } }),
    prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
    prisma.user.count({ where: { lockedUntil: { gt: hoursAgo(0) } } }),
    prisma.outboxEvent.count({ where: { status: "DEAD" } }),
    prisma.aIInteraction.groupBy({ by: ["feature", "status"], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
    prisma.aIInteraction.count({ where: { createdAt: { gte: since }, status: "FALLBACK" } }),
    prisma.auditEvent.count({ where: { createdAt: { gte: since } } }),
  ]);
  const provider = getAIProvider();
  return (
    <>
      <PageHeader title="System health" description="Operational metrics for the last 24 hours." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Database round-trip" value={`${dbMs} ms`} tone={dbMs > 500 ? "warning" : "success"} />
        <StatCard label="Active users" value={users} />
        <StatCard label="Live sessions" value={sessions} />
        <StatCard label="Audit events (24h)" value={audit} />
        <StatCard label="Failed sign-ins (24h)" value={failedLogins} tone={failedLogins > 50 ? "warning" : undefined} />
        <StatCard label="Locked accounts" value={locked} tone={locked ? "warning" : undefined} />
        <StatCard label="Undeliverable emails" value={outboxDead} tone={outboxDead ? "danger" : undefined} href="/admin/outbox" />
        <StatCard label="AI fallbacks (24h)" value={aiErrors} hint={provider ? provider.model : "AI disabled"} />
      </div>
      <Card><CardHeader title="AI usage and cost monitoring (24h)" description="Token counts are reported by the provider; no prompt content is stored." />
        <Table caption="AI usage"><THead><tr><TH>Feature</TH><TH>Status</TH><TH className="text-right">Calls</TH><TH className="text-right">Input tokens</TH><TH className="text-right">Output tokens</TH></tr></THead>
          <tbody>{ai.map((r) => <TR key={`${r.feature}-${r.status}`}><TD>{r.feature}</TD><TD>{r.status}</TD><TD className="text-right">{r._count._all}</TD><TD className="text-right">{r._sum.inputTokens ?? 0}</TD><TD className="text-right">{r._sum.outputTokens ?? 0}</TD></TR>)}{!ai.length && <TR><TD colSpan={5} className="text-muted">No AI calls in the last 24 hours.</TD></TR>}</tbody></Table>
      </Card>
      <Card className="mt-6"><CardBody className="text-sm text-muted">Runtime: Node {process.version} · Email provider: {process.env.EMAIL_PROVIDER ?? "console"} · Storage: {storageDriverKind()}</CardBody></Card>
    </>
  );
}
