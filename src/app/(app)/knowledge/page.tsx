import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { searchKnowledge } from "@/modules/knowledge/service";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { formatDate, humanize } from "@/lib/utils";

export const metadata = { title: "Knowledge repository" };
const CATS = ["COMPLETED_PROJECT", "REUSABLE_SOLUTION", "TECHNICAL_DOCUMENTATION", "LESSON_LEARNED", "COMMON_INCIDENT", "IMPLEMENTATION_PATTERN", "TRAINING_RESOURCE"];

export default async function Knowledge({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActor("knowledge.read");
  const docs = await searchKnowledge(actor, sp.q ?? "", sp.category, 50);
  return (
    <>
      <PageHeader title="Knowledge repository" description="Institutional memory: reusable solutions, lessons learned and approved patterns. Results only include documents you are authorised to see." actions={can(actor, "knowledge.manage") ? <Button asChild><Link href="/knowledge/new">New document</Link></Button> : undefined} />
      <form method="get" className="mb-4 flex flex-wrap gap-2"><Input name="q" defaultValue={sp.q} placeholder="Search knowledge (full text)" className="w-80" aria-label="Search knowledge" /><Select name="category" defaultValue={sp.category ?? ""} className="w-60" aria-label="Category"><option value="">All categories</option>{CATS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select><Button type="submit" variant="secondary">Search</Button></form>
      {docs.length === 0 ? <EmptyState title="No documents found" /> : (
        <ul className="space-y-3">{docs.map((d) => (
          <li key={d.id} className="rounded-[var(--radius-card)] border border-line bg-white p-4">
            <div className="flex flex-wrap items-center gap-2"><Link href={`/knowledge/${d.id}`} className="font-semibold">{d.title}</Link><Badge>{humanize(d.category)}</Badge>{d.status !== "PUBLISHED" && <StatusBadge status={d.status} />}</div>
            <p className="mt-1 text-sm text-muted">{d.summary}</p>
            <p className="mt-1 text-xs text-muted">{d.tags.map((t) => `#${t}`).join(" ")} · updated {formatDate(d.updatedAt)}</p>
          </li>
        ))}</ul>
      )}
    </>
  );
}
