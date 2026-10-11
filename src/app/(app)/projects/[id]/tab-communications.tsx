import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { formatDateTime, humanize } from "@/lib/utils";
import { listProjectComments } from "@/modules/projects/delivery";
import { can } from "@/modules/rbac/authorize";
import { commentProjectAction } from "../actions";
import type { TabProps } from "./types";

export async function CommunicationsTab({ p, actor, internal }: TabProps) {
  const comments = await listProjectComments(actor, p.id);
  const isMda = actor.userType === "MDA_USER";
  const team = [...(p.projectManager ? [p.projectManager] : []), ...p.assignments.filter((a) => ["PENDING_ACKNOWLEDGMENT", "ACKNOWLEDGED"].includes(a.status) && a.assignee.id !== p.projectManagerId).map((a) => a.assignee)];
  const canPost = actor.userType !== "OVERSIGHT" && (can(actor, "project.comment.external") || can(actor, "project.comment.internal"));
  return (
    <Card><CardBody className="space-y-4">
      {internal && <p className="text-xs text-muted">Internal notes (amber) are visible only to KATDICT and oversight users. MDA-visible messages are shared with the MDA.</p>}
      {comments.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className={`rounded-md border p-3 text-sm ${c.visibility === "INTERNAL" ? "border-amber-200 bg-warn-100/40" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <strong className="text-ink">{isMda && c.author.userType !== "MDA_USER" ? `${c.author.name} (KATDICT)` : c.author.name}</strong>
              {c.visibility === "INTERNAL" && <Badge tone="warning">Internal note</Badge>}
              {c.kind !== "COMMENT" && <Badge tone="info">{humanize(c.kind)}</Badge>}
              <span>{formatDateTime(c.createdAt)}</span>
              {internal && <span>· read by {c.readCount}</span>}
            </div>
            <p className="mt-1 whitespace-pre-line">{c.body}</p>
          </li>
        ))}
      </ul>
      {canPost && !["CLOSED", "CANCELLED"].includes(p.status) && (
        <ActionForm action={commentProjectAction} submitLabel="Send" resetOnSuccess>
          <input type="hidden" name="projectId" value={p.id} />
          <Field label="Message" name="body" required><Textarea rows={3} /></Field>
          {internal && actor.userType === "KATDICT_STAFF" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Visibility" name="visibility"><Select defaultValue={can(actor, "project.comment.external") ? "MDA_VISIBLE" : "INTERNAL"}><option value="MDA_VISIBLE">Visible to the MDA</option><option value="INTERNAL">Internal KATDICT note</option></Select></Field>
              <Field label="Mention team members" name="mentions" hint="Mentioned people are emailed."><Select multiple className="h-20">{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
            </div>
          )}
        </ActionForm>
      )}
    </CardBody></Card>
  );
}
