"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";

export interface UploadedFile {
  id: string;
  originalName: string;
  sizeBytes: number;
}

const CATEGORIES = [
  ["REQUEST_DOCUMENT", "Request document"], ["TECHNICAL_SPECIFICATION", "Technical specification"], ["PROPOSAL", "Project proposal"],
  ["ARCHITECTURE", "Architecture document"], ["TEST_EVIDENCE", "Testing evidence"], ["EVIDENCE", "Completion evidence"], ["COMPLETION_REPORT", "Completion report"],
  ["USER_MANUAL", "User manual"], ["TRAINING_MATERIAL", "Training material"], ["HANDOVER", "Handover documentation"], ["OTHER", "Other"],
] as const;

/** Uploads to /api/files; the server validates type by signature, size, and authorisation. */
export function FileUploader({ target, onUploaded, allowInternal = false, categories = true, defaultCategory = "REQUEST_DOCUMENT", maxMb = 4 }: {
  target: { requestId?: string; projectId?: string; deliverableId?: string; knowledgeDocumentId?: string };
  onUploaded?: (f: UploadedFile) => void;
  allowInternal?: boolean;
  categories?: boolean;
  defaultCategory?: string;
  maxMb?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [category, setCategory] = useState(defaultCategory);
  const [visibility, setVisibility] = useState("MDA_VISIBLE");

  async function upload(file: File) {
    if (file.size > maxMb * 1024 * 1024) {
      setMsg({ ok: false, text: `File is larger than ${maxMb} MB.` });
      return;
    }
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    for (const [k, v] of Object.entries(target)) if (v) fd.set(k, v);
    fd.set("category", category);
    fd.set("visibility", visibility);
    try {
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      setMsg({ ok: true, text: `Uploaded ${body.originalName}` });
      onUploaded?.(body);
      if (!onUploaded) window.location.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {categories && (
        <Select aria-label="Document type" value={category} onChange={(e) => setCategory(e.target.value)} className="w-56">
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      )}
      {allowInternal && (
        <Select aria-label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)} className="w-48">
          <option value="MDA_VISIBLE">Visible to MDA</option>
          <option value="INTERNAL">Internal (KATDICT only)</option>
        </Select>
      )}
      <input ref={input} type="file" className="sr-only" id={`file-${Object.values(target).join("-")}`} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.csv,.txt,.zip" />
      <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} {busy ? "Uploading…" : "Attach file"}
      </Button>
      <span className="text-xs text-muted">PDF, images, Office, CSV, text or ZIP · max {maxMb} MB</span>
      {msg && <span role="status" className={msg.ok ? "text-xs text-accent-700" : "text-xs text-danger-700"}>{msg.text}</span>}
    </div>
  );
}
