import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import type { Actor } from "@/modules/rbac/actor";
import { decisionTrail } from "@/modules/audit/query";

/** Digital Decision Trail: ordered decisions with actor, time, previous/new state and reason. */
export async function DecisionTrail({ actor, requestId, projectId }: { actor: Actor; requestId?: string; projectId?: string }) {
  const { items } = await decisionTrail(actor, { requestId, projectId });
  if (!items.length) return <p className="text-sm text-muted">No decisions recorded yet.</p>;
  return (
    <ol className="relative space-y-4 border-l-2 border-line pl-5">
      {items.map((d, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-navy-700" aria-hidden />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-navy-50 px-1.5 text-xs font-medium text-navy-800">{d.scope}</span>
            <span className="font-medium capitalize">{d.action}</span>
            {d.from && <><StatusBadge status={d.from} /><span aria-hidden>→</span></>}
            {d.to && <StatusBadge status={d.to} />}
          </div>
          <p className="mt-0.5 text-xs text-muted">{d.actor} · {formatDateTime(d.at)}</p>
          {d.reason && <p className="mt-1 whitespace-pre-line text-sm">“{d.reason}”</p>}
          {d.evidence && <p className="mt-1 text-xs text-muted">Evidence: {d.evidence}</p>}
        </li>
      ))}
    </ol>
  );
}
