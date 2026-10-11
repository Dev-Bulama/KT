import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { globalSearch } from "@/modules/search/service";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { enforceRateLimit } from "@/lib/rate-limit";

export const metadata = { title: "Search" };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const actor = await requirePageActor();
  if (q) await enforceRateLimit(`search:${actor.id}`, 120, 60);
  const hits = q ? await globalSearch(actor, q) : [];
  const groups = [...new Set(hits.map((h) => h.type))];
  return (
    <>
      <PageHeader title="Search" description="Results are filtered by your permissions before they are shown." />
      <form method="get" className="mb-6 flex max-w-xl gap-2"><Input name="q" defaultValue={q} placeholder="Reference, title, MDA, officer, milestone, document…" aria-label="Search" autoFocus /><Button type="submit">Search</Button></form>
      {q && !hits.length && <EmptyState title={`No results for “${q}”`} />}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g}s</h2>
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-white">
              {hits.filter((h) => h.type === g).map((h) => <li key={`${h.type}-${h.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"><Link href={h.href}>{h.title}</Link><span className="flex items-center gap-2 text-xs text-muted">{h.subtitle}<Badge>{h.type}</Badge></span></li>)}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
