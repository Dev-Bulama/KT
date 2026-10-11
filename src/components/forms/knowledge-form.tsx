import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { humanize } from "@/lib/utils";
import { saveKnowledgeAction } from "@/app/(app)/knowledge/actions";

const CATS = ["COMPLETED_PROJECT", "REUSABLE_SOLUTION", "TECHNICAL_DOCUMENTATION", "LESSON_LEARNED", "COMMON_INCIDENT", "IMPLEMENTATION_PATTERN", "TRAINING_RESOURCE"];

export function KnowledgeForm({ doc, mdas }: { doc?: { id: string; title: string; summary: string; body: string; category: string; tags: string[]; visibility: string; mdaId: string | null; projectId: string | null }; mdas: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveKnowledgeAction} submitLabel={doc ? "Save (returns to draft for re-approval)" : "Save draft"}>
      {(e) => (<>
        {doc && <input type="hidden" name="id" value={doc.id} />}
        {doc?.projectId && <input type="hidden" name="projectId" value={doc.projectId} />}
        <Field label="Title" name="title" required error={e.title}><Input defaultValue={doc?.title} /></Field>
        <Field label="Summary" name="summary" required error={e.summary}><Textarea rows={2} defaultValue={doc?.summary} /></Field>
        <Field label="Content" name="body" required error={e.body}><Textarea rows={12} defaultValue={doc?.body} /></Field>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Category" name="category" required><Select defaultValue={doc?.category ?? "LESSON_LEARNED"}>{CATS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></Field>
          <Field label="Tags (comma-separated)" name="tags"><Input defaultValue={doc?.tags.join(", ")} /></Field>
          <Field label="Visibility" name="visibility"><Select defaultValue={doc?.visibility ?? "KATDICT_ONLY"}><option value="KATDICT_ONLY">KATDICT only</option><option value="ALL_USERS">All platform users</option><option value="MDA_SPECIFIC">One MDA</option></Select></Field>
          <Field label="MDA (if MDA-specific)" name="mdaId"><Select defaultValue={doc?.mdaId ?? ""}><option value="">—</option>{mdas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        </div>
      </>)}
    </ActionForm>
  );
}
