"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { FileUploader, type UploadedFile } from "@/components/forms/file-uploader";
import { cn } from "@/lib/utils";
import { saveDraftAction, submitDraftAction } from "./actions";

interface Service { id: string; name: string; description: string; requiredInformation: string[]; requiredAttachments: string[]; estimatedMinDays: number | null; estimatedMaxDays: number | null; standardDeliverables: string[] }
interface Category { id: string; name: string; description: string | null; services: Service[] }

const schema = z.object({
  serviceId: z.string().min(1, "Select a service"),
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(200),
  problemStatement: z.string().trim().min(30, "Describe the problem (at least 30 characters)").max(5000),
  currentSituation: z.string().max(5000).optional(),
  desiredOutcome: z.string().trim().min(15, "Describe the desired outcome (at least 15 characters)").max(5000),
  businessJustification: z.string().trim().min(15, "Provide a business justification (at least 15 characters)").max(5000),
  expectedBeneficiaries: z.string().max(2000).optional(),
  estimatedUsers: z.string().regex(/^\d*$/, "Enter a whole number").optional(),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  preferredCompletionDate: z.string().optional(),
  existingSystems: z.string().max(3000).optional(),
  technicalInformation: z.string().max(5000).optional(),
  knownDependencies: z.string().max(3000).optional(),
  expectedDeliverables: z.string().trim().min(5, "List the expected deliverables").max(5000),
  successCriteria: z.string().trim().min(5, "State how success will be measured").max(5000),
  institutionalImpact: z.string().trim().min(10, "Describe the institutional impact").max(5000),
  operationalUrgency: z.string().max(3000).optional(),
  legalConsiderations: z.string().max(3000).optional(),
  consequencesOfInaction: z.string().trim().min(10, "Describe the consequences of not addressing the request").max(5000),
});
type FormValues = z.infer<typeof schema>;

const STEPS = [
  { title: "Service", fields: ["serviceId"] },
  { title: "Request information", fields: ["title", "problemStatement", "currentSituation", "desiredOutcome", "businessJustification", "expectedBeneficiaries", "estimatedUsers", "urgency", "preferredCompletionDate", "existingSystems", "technicalInformation", "knownDependencies", "expectedDeliverables", "successCriteria"] },
  { title: "Impact & priority", fields: ["institutionalImpact", "operationalUrgency", "legalConsiderations", "consequencesOfInaction"] },
  { title: "Documents", fields: [] },
  { title: "Review & submit", fields: [] },
] as const;

const LABELS: Record<string, string> = {
  title: "Request title", problemStatement: "Problem statement", currentSituation: "Current situation", desiredOutcome: "Desired outcome",
  businessJustification: "Business justification", expectedBeneficiaries: "Expected beneficiaries", estimatedUsers: "Estimated number of users",
  urgency: "Urgency", preferredCompletionDate: "Preferred completion date", existingSystems: "Existing systems involved", technicalInformation: "Relevant technical information",
  knownDependencies: "Known dependencies", expectedDeliverables: "Expected deliverables", successCriteria: "Success criteria",
  institutionalImpact: "Institutional impact", operationalUrgency: "Operational urgency", legalConsiderations: "Legal or regulatory considerations",
  consequencesOfInaction: "Consequences of not addressing the request",
};

export function RequestWizard({ catalog, initial }: { catalog: Category[]; initial?: { id: string; version: number; values: Partial<FormValues>; attachments: UploadedFile[] } }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(initial ? { id: initial.id, version: initial.version } : null);
  const [files, setFiles] = useState<UploadedFile[]>(initial?.attachments ?? []);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  // One key per wizard session: repeated clicks / retries cannot create duplicate submissions.
  const submissionKey = useRef<string>("");
  useEffect(() => {
    submissionKey.current = crypto.randomUUID().replace(/-/g, "");
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { urgency: "MEDIUM", serviceId: "", title: "", ...initial?.values },
  });
  const { register, formState: { errors }, watch, trigger, getValues } = form;
  const serviceId = watch("serviceId");
  const service = useMemo(() => catalog.flatMap((c) => c.services).find((s) => s.id === serviceId), [catalog, serviceId]);
  const [categoryId, setCategoryId] = useState(() => catalog.find((c) => c.services.some((s) => s.id === initial?.values.serviceId))?.id ?? "");
  const err = (k: keyof FormValues) => errors[k]?.message ?? serverErrors[k]?.join(" ");

  async function save(): Promise<{ id: string; version: number } | null> {
    const v = getValues();
    if (!v.serviceId || !v.title || v.title.trim().length < 5) return draft;
    const res = await saveDraftAction({ ...v, id: draft?.id, version: draft?.version });
    if (!res.ok) {
      setStatus({ ok: false, text: res.message ?? "Could not save draft." });
      setServerErrors(res.fieldErrors ?? {});
      return null;
    }
    const d = { id: String(res.data!.id), version: Number(res.data!.version) };
    setDraft(d);
    setStatus({ ok: true, text: `Draft saved at ${new Date().toLocaleTimeString()}` });
    return d;
  }

  async function next() {
    const ok = await trigger(STEPS[step].fields as unknown as (keyof FormValues)[]);
    if (!ok) return;
    setBusy(true);
    if (step >= 1) {
      const d = await save();
      setBusy(false);
      if (!d) return;
    } else setBusy(false);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    const ok = await trigger();
    if (!ok) {
      setStatus({ ok: false, text: "Some required information is missing. Review the earlier steps." });
      return;
    }
    setBusy(true);
    const d = await save();
    if (!d) return setBusy(false);
    const res = await submitDraftAction(d.id, submissionKey.current);
    if (!res.ok) {
      setBusy(false);
      setServerErrors(res.fieldErrors ?? {});
      setStatus({ ok: false, text: res.message ?? "Submission failed." });
      return;
    }
    router.push(`/requests/${d.id}?submitted=1`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <ol className="space-y-1 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className={cn("flex items-center gap-2 rounded-md px-3 py-2", i === step ? "bg-navy-900 text-white" : i < step ? "text-accent-700" : "text-muted")} aria-current={i === step ? "step" : undefined}>
            {i < step ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <span className="flex h-5 w-5 items-center justify-center rounded-full border text-xs">{i + 1}</span>}
            {s.title}
          </li>
        ))}
      </ol>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-5 rounded-[var(--radius-card)] border border-line bg-white p-5" noValidate>
        {step === 0 && (
          <>
            <h2 className="text-lg font-semibold">1. Select a service</h2>
            <Field label="Service category" name="categoryId" required>
              <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); form.setValue("serviceId", ""); }}>
                <option value="">— Select a category —</option>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            {categoryId && (
              <Field label="Service" name="serviceId" required error={err("serviceId")}>
                <Select {...register("serviceId")}>
                  <option value="">— Select a service —</option>
                  {catalog.find((c) => c.id === categoryId)?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
            {service && (
              <Alert tone="info" title={service.name}>
                <p>{service.description}</p>
                {service.standardDeliverables.length > 0 && <p className="mt-1">Typical deliverables: {service.standardDeliverables.join(", ")}.</p>}
                {service.estimatedMinDays && <p className="mt-1">Indicative delivery: {service.estimatedMinDays}–{service.estimatedMaxDays} days.</p>}
                {service.requiredAttachments.length > 0 && <p className="mt-1 font-medium">Required documents: {service.requiredAttachments.join(", ")}.</p>}
              </Alert>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="text-lg font-semibold">2. Request information</h2>
            <Field label={LABELS.title} name="title" required error={err("title")}><Input {...register("title")} /></Field>
            <Field label={LABELS.problemStatement} name="problemStatement" required error={err("problemStatement")} hint="What is not working today, for whom, and how often?"><Textarea {...register("problemStatement")} rows={4} /></Field>
            <Field label={LABELS.currentSituation} name="currentSituation"><Textarea {...register("currentSituation")} /></Field>
            <Field label={LABELS.desiredOutcome} name="desiredOutcome" required error={err("desiredOutcome")}><Textarea {...register("desiredOutcome")} /></Field>
            <Field label={LABELS.businessJustification} name="businessJustification" required error={err("businessJustification")}><Textarea {...register("businessJustification")} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={LABELS.expectedBeneficiaries} name="expectedBeneficiaries"><Input {...register("expectedBeneficiaries")} /></Field>
              <Field label={LABELS.estimatedUsers} name="estimatedUsers" error={err("estimatedUsers")}><Input inputMode="numeric" {...register("estimatedUsers")} /></Field>
              <Field label={LABELS.urgency} name="urgency" required><Select {...register("urgency")}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></Select></Field>
            </div>
            <Field label={LABELS.preferredCompletionDate} name="preferredCompletionDate"><Input type="date" {...register("preferredCompletionDate")} className="w-56" /></Field>
            <Field label={LABELS.existingSystems} name="existingSystems"><Textarea {...register("existingSystems")} /></Field>
            <Field label={LABELS.technicalInformation} name="technicalInformation"><Textarea {...register("technicalInformation")} /></Field>
            <Field label={LABELS.knownDependencies} name="knownDependencies"><Textarea {...register("knownDependencies")} /></Field>
            <Field label={LABELS.expectedDeliverables} name="expectedDeliverables" required error={err("expectedDeliverables")}><Textarea {...register("expectedDeliverables")} /></Field>
            <Field label={LABELS.successCriteria} name="successCriteria" required error={err("successCriteria")} hint="Use measurable targets where possible."><Textarea {...register("successCriteria")} /></Field>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="text-lg font-semibold">3. Impact and priority</h2>
            <Field label={LABELS.institutionalImpact} name="institutionalImpact" required error={err("institutionalImpact")}><Textarea {...register("institutionalImpact")} /></Field>
            <Field label={LABELS.operationalUrgency} name="operationalUrgency"><Textarea {...register("operationalUrgency")} /></Field>
            <Field label={LABELS.legalConsiderations} name="legalConsiderations" hint="Laws, regulations, audit findings or directives that apply."><Textarea {...register("legalConsiderations")} /></Field>
            <Field label={LABELS.consequencesOfInaction} name="consequencesOfInaction" required error={err("consequencesOfInaction")}><Textarea {...register("consequencesOfInaction")} /></Field>
          </>
        )}
        {step === 3 && (
          <>
            <h2 className="text-lg font-semibold">4. Supporting documents</h2>
            {service?.requiredAttachments.length ? <Alert tone="warning">This service requires: {service.requiredAttachments.join(", ")}.</Alert> : <p className="text-sm text-muted">Attach any documents that help KATDICT assess the request (optional for this service).</p>}
            {draft ? <FileUploader target={{ requestId: draft.id }} onUploaded={(f) => setFiles((x) => [...x, f])} /> : <Alert tone="warning">Save the draft first.</Alert>}
            <ul className="space-y-1 text-sm">{files.map((f) => <li key={f.id}>📎 {f.originalName} <span className="text-muted">({Math.ceil(f.sizeBytes / 1024)} KB)</span></li>)}</ul>
          </>
        )}
        {step === 4 && (
          <>
            <h2 className="text-lg font-semibold">5. Review and submit</h2>
            <dl className="divide-y divide-line text-sm">
              <div className="grid gap-1 py-2 sm:grid-cols-3"><dt className="font-medium text-muted">Service</dt><dd className="sm:col-span-2">{service?.name ?? "—"}</dd></div>
              {Object.entries(LABELS).map(([k, label]) => (
                <div key={k} className="grid gap-1 py-2 sm:grid-cols-3"><dt className="font-medium text-muted">{label}</dt><dd className="whitespace-pre-line sm:col-span-2">{String(getValues(k as keyof FormValues) || "—")}</dd></div>
              ))}
              <div className="grid gap-1 py-2 sm:grid-cols-3"><dt className="font-medium text-muted">Documents</dt><dd className="sm:col-span-2">{files.length ? files.map((f) => f.originalName).join(", ") : "None"}</dd></div>
            </dl>
            <Alert tone="info">After submission the request is locked and receives a reference number. KATDICT may ask for more information.</Alert>
          </>
        )}
        {status && <Alert tone={status.ok ? "success" : "danger"}>{status.text}</Alert>}
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>Back</Button>
          <div className="flex gap-2">
            {step >= 1 && <Button type="button" variant="ghost" disabled={busy} onClick={() => save()}>Save draft</Button>}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={next} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Continue</Button>
            ) : (
              <Button type="button" variant="accent" onClick={submit} disabled={busy} aria-busy={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Submitting…" : "Submit request"}</Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
