/**
 * File-type detection from magic bytes. The browser-supplied filename and
 * content type are NOT trusted; only signatures determine the stored type.
 */
export interface Sniffed {
  ext: string;
  mime: string;
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

export function sniffFileType(bytes: Uint8Array, declaredName: string): Sniffed | null {
  if (bytes.length < 4) return null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: "pdf", mime: "application/pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png", mime: "image/png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP container: Office Open XML documents are ZIPs containing [Content_Types].xml.
    const head = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 8192)));
    const lower = declaredName.toLowerCase();
    if (head.includes("[Content_Types].xml") || head.includes("word/") || head.includes("xl/") || head.includes("ppt/")) {
      if (head.includes("word/") || lower.endsWith(".docx")) return { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
      if (head.includes("xl/") || lower.endsWith(".xlsx")) return { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
      if (head.includes("ppt/") || lower.endsWith(".pptx")) return { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
    }
    return { ext: "zip", mime: "application/zip" };
  }
  // Text formats: must be valid UTF-8 without NUL bytes; type chosen by extension.
  const sample = bytes.slice(0, Math.min(bytes.length, 65536));
  if (!sample.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample);
      const lower = declaredName.toLowerCase();
      if (lower.endsWith(".csv")) return { ext: "csv", mime: "text/csv" };
      return { ext: "txt", mime: "text/plain" };
    } catch {
      return null;
    }
  }
  return null;
}

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\w.\- ()]/g, "_").replace(/\.{2,}/g, ".").slice(0, 150) || "file";
}
