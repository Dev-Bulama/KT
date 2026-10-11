import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, XCircle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, breadcrumbs }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumbs.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden>/</span>}
                {b.href ? <Link href={b.href} className="text-muted hover:text-navy-700">{b.label}</Link> : <span aria-current="page">{b.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}

const alertStyles = {
  info: { cls: "border-navy-100 bg-info-100 text-info-700", Icon: Info },
  success: { cls: "border-green-200 bg-accent-100 text-accent-700", Icon: CheckCircle2 },
  warning: { cls: "border-amber-200 bg-warn-100 text-warn-700", Icon: AlertTriangle },
  danger: { cls: "border-red-200 bg-danger-100 text-danger-700", Icon: XCircle },
};

export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof alertStyles; title?: string; children?: React.ReactNode; className?: string }) {
  const { cls, Icon } = alertStyles[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line bg-white px-6 py-10 text-center">
      <Inbox className="h-8 w-8 text-slate-400" aria-hidden />
      <p className="mt-3 font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} aria-hidden />;
}

export function StatCard({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "danger" | "warning" | "success" }) {
  const inner = (
    <div className={cn("h-full rounded-[var(--radius-card)] border bg-white px-4 py-3 transition-colors", tone === "danger" ? "border-red-200" : tone === "warning" ? "border-amber-200" : "border-line", href && "hover:border-navy-700")}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", tone === "danger" ? "text-danger-700" : tone === "warning" ? "text-warn-700" : tone === "success" ? "text-accent-700" : "text-navy-950")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block no-underline">{inner}</Link> : inner;
}

export function DescriptionList({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 whitespace-pre-line break-words text-sm">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"}>
        <div className={cn("h-full rounded-full", v === 100 ? "bg-accent-600" : "bg-navy-700")} style={{ width: `${v}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted">{v}%</span>
    </div>
  );
}
