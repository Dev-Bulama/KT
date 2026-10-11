import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Input, Checkbox } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { FileUploader } from "@/components/forms/file-uploader";
import { AttachmentList } from "@/components/shared/attachment-list";
import { deliverableAction, submitDeliverableAction } from "../actions";
import type { TabProps } from "./types";

export function FilesTab({ p, canWork, internal }: TabProps) {
  const open = !["CLOSED", "CANCELLED"].includes(p.status);
  const hidden = <input type="hidden" name="projectId" value={p.id} />;
  const loose = p.attachments.filter((a) => !a.deliverableId);
  return (
    <div className="space-y-6">
      <Card><CardHeader title="Deliverables" description="Required deliverables must be submitted with evidence before completion, and accepted before closure." /><CardBody className="space-y-4">
        {p.deliverables.length === 0 && <p className="text-sm text-muted">No deliverables defined.</p>}
        {p.deliverables.map((d) => (
          <div key={d.id} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{d.title} {d.required && <span className="text-xs text-muted">(required)</span>}</p>
              <StatusBadge status={d.status} />
            </div>
            {d.description && <p className="text-sm text-muted">{d.description}</p>}
            <div className="mt-2"><AttachmentList items={d.attachments.map((a) => ({ ...a }))} showVisibility={internal} /></div>
            {canWork && open && d.status !== "ACCEPTED" && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <FileUploader target={{ deliverableId: d.id }} categories={false} allowInternal={false} />
                {d.status === "PLANNED" && d.attachments.length > 0 && <ActionForm inline action={submitDeliverableAction} submitLabel="Mark as submitted" submitVariant="accent">{hidden}<input type="hidden" name="deliverableId" value={d.id} /></ActionForm>}
              </div>
            )}
          </div>
        ))}
        {canWork && open && (
          <ActionForm action={deliverableAction} submitLabel="Add deliverable" inline resetOnSuccess>{hidden}
            <Input name="title" placeholder="Deliverable title" aria-label="Deliverable title" required className="w-72" />
            <Input name="description" placeholder="Description (optional)" aria-label="Description" className="w-72" />
            <Checkbox name="required" label="Required" defaultChecked />
          </ActionForm>
        )}
      </CardBody></Card>
      <Card><CardHeader title="Project documents" description="Evidence, technical documentation, manuals, training and handover documents." /><CardBody className="space-y-4">
        <AttachmentList items={loose} showVisibility={internal} />
        {canWork && open && <FileUploader target={{ projectId: p.id }} allowInternal defaultCategory="EVIDENCE" />}
      </CardBody></Card>
    </div>
  );
}
