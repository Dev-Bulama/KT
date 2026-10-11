import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { dataQualityReport } from "@/modules/quality/data-quality";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Data quality" };

export default async function DataQuality() {
  const actor = await requirePageActor("dataquality.view");
  const { checks } = await dataQualityReport(actor);
  return (
    <>
      <PageHeader title="Data Quality Centre" description="Automated checks for missing, duplicate and inconsistent records. Nothing is changed automatically: each item links to the normal, audited correction workflow." />
      <div className="space-y-3">
        {checks.map((c) => (
          <details key={c.key} className="rounded-[var(--radius-card)] border border-line bg-white" open={c.items.length > 0 && c.items.length < 6}>
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium">{c.label}<Badge tone={c.items.length ? "warning" : "success"}>{c.items.length}</Badge></summary>
            {c.items.length > 0 && <ul className="divide-y divide-line border-t border-line text-sm">{c.items.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-2 px-4 py-2"><Link href={i.href}>{i.label}</Link><span className="text-xs text-muted">{i.detail}</span></li>)}</ul>}
          </details>
        ))}
      </div>
    </>
  );
}
