import Link from "next/link";

/** Lightweight horizontal bar list (pure HTML/CSS; no chart library payload). Single series → no legend. */
export function BarList({ items, emptyText = "No data recorded." }: { items: { label: string; value: number; href?: string; note?: string }[]; emptyText?: string }) {
  if (!items.length) return <p className="text-sm text-muted">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex justify-between gap-3">
            {i.href ? <Link href={i.href} className="truncate">{i.label}</Link> : <span className="truncate">{i.label}</span>}
            <span className="tabular-nums text-ink">{i.value}{i.note ? <span className="ml-1 text-xs text-muted">{i.note}</span> : null}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100" title={`${i.label}: ${i.value}`}>
            <div className="h-full rounded-full bg-[#2f62b8]" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
