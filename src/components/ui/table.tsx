import Link from "next/link";
import { cn } from "@/lib/utils";

export function Table({ children, className, caption }: { children: React.ReactNode; className?: string; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-white">
      <table className={cn("w-full text-left text-sm", className)}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-line bg-navy-50 text-xs uppercase tracking-wide text-muted">{children}</thead>;
}
export function TH({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th scope="col" className={cn("px-4 py-2.5 font-medium", className)}>{children}</th>;
}
export function TR({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("border-b border-line last:border-0 hover:bg-navy-50/40", className)}>{children}</tr>;
}
export function TD({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("px-4 py-2.5 align-top", className)}>{children}</td>;
}

/** Server-rendered pagination preserving existing query parameters. */
export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-muted">
      <span>{total === 0 ? "No results" : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-line bg-white px-3 py-1 no-underline" href={href(page - 1)}>Previous</Link> : <span className="rounded-md border border-line px-3 py-1 opacity-50">Previous</span>}
        <span className="px-2 py-1">Page {page} of {pages}</span>
        {page < pages ? <Link className="rounded-md border border-line bg-white px-3 py-1 no-underline" href={href(page + 1)}>Next</Link> : <span className="rounded-md border border-line px-3 py-1 opacity-50">Next</span>}
      </div>
    </nav>
  );
}
