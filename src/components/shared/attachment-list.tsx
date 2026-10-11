import { FileText, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, humanize } from "@/lib/utils";

export function AttachmentList({ items, showVisibility }: { items: { id: string; originalName: string; sizeBytes: number; category: string; visibility: string; scanStatus: string; createdAt: Date; uploadedBy?: { name: string } }[]; showVisibility?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">No documents.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="flex items-center gap-2">
            {a.scanStatus === "QUARANTINED" ? <ShieldAlert className="h-4 w-4 text-danger-700" aria-hidden /> : <FileText className="h-4 w-4 text-navy-700" aria-hidden />}
            {a.scanStatus === "QUARANTINED" ? <span>{a.originalName} (quarantined)</span> : <a href={`/api/files/${a.id}`}>{a.originalName}</a>}
            <span className="text-xs text-muted">{Math.ceil(a.sizeBytes / 1024)} KB · {humanize(a.category)}</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-muted">
            {showVisibility && <Badge tone={a.visibility === "INTERNAL" ? "warning" : "info"}>{a.visibility === "INTERNAL" ? "Internal" : "MDA visible"}</Badge>}
            {a.uploadedBy?.name} · {formatDateTime(a.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
