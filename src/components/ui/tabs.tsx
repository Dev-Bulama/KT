import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (server-rendered; each tab is a link, so it works without JS). */
export function Tabs({ tabs, active, basePath, param = "tab" }: { tabs: { key: string; label: string; count?: number }[]; active: string; basePath: string; param?: string }) {
  const p = basePath === "/dashboard" ? "view" : param;
  return (
    <div className="mb-5 overflow-x-auto border-b border-line no-print">
      <nav className="-mb-px flex gap-1" aria-label="Sections">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`${basePath}?${p}=${t.key}`}
            aria-current={active === t.key ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium no-underline", active === t.key ? "border-navy-900 text-navy-950" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs">{t.count}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
