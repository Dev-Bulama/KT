import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Minimal document model rendered to a formal, printable A4 PDF suitable for
 * government filing (header, reference, page numbers, generation timestamp).
 */
export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "fields"; rows: [string, string][] }
  | { kind: "table"; columns: string[]; rows: string[][] };

export interface PdfDoc {
  title: string;
  subtitle?: string;
  reference?: string;
  version?: string;
  status?: string;
  generatedAt: string;
  blocks: Block[];
}

const A4 = { w: 595.28, h: 841.89 };
const M = 50;
const NAVY = rgb(0.043, 0.165, 0.357);
const GREY = rgb(0.36, 0.42, 0.52);

// Standard PDF fonts only cover WinAnsi; replace other characters.
function clean(s: string): string {
  return (s ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/↔/g, "<->").replace(/•/g, "-").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= width) line = test;
      else {
        if (line) out.push(line);
        // Hard-break very long words.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderPdf(doc: PdfDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(doc.title));
  pdf.setProducer("KATDICT SPIMP");
  pdf.setCreator("KATDICT Service & Project Intelligence Management Platform");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const width = A4.w - 2 * M;

  const header = (p: PDFPage) => {
    p.drawRectangle({ x: 0, y: A4.h - 28, width: A4.w, height: 28, color: NAVY });
    p.drawText("KATSINA STATE DIRECTORATE OF ICT (KATDICT)", { x: M, y: A4.h - 19, size: 9, font: bold, color: rgb(1, 1, 1) });
    if (doc.reference) p.drawText(clean(doc.reference), { x: A4.w - M - font.widthOfTextAtSize(clean(doc.reference), 9), y: A4.h - 19, size: 9, font, color: rgb(1, 1, 1) });
  };
  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    header(page);
    y = A4.h - M - 10;
  };
  const ensure = (h: number) => {
    if (y - h < M + 20) newPage();
  };
  header(page);
  y -= 20;
  for (const line of wrap(doc.title, bold, 16, width)) {
    page.drawText(line, { x: M, y, size: 16, font: bold, color: NAVY });
    y -= 20;
  }
  if (doc.subtitle) {
    page.drawText(clean(doc.subtitle), { x: M, y, size: 10, font, color: GREY });
    y -= 16;
  }
  const meta = [doc.version ? `Version ${doc.version}` : null, doc.status ? `Status: ${doc.status}` : null, `Generated: ${doc.generatedAt}`].filter(Boolean).join("   |   ");
  page.drawText(clean(meta), { x: M, y, size: 9, font, color: GREY });
  y -= 10;
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.8, color: NAVY });
  y -= 18;

  for (const b of doc.blocks) {
    if (b.kind === "heading") {
      ensure(30);
      y -= 6;
      page.drawText(clean(b.text), { x: M, y, size: 12, font: bold, color: NAVY });
      y -= 16;
    } else if (b.kind === "paragraph") {
      for (const line of wrap(b.text || "Not recorded", font, 10, width)) {
        ensure(14);
        page.drawText(line, { x: M, y, size: 10, font });
        y -= 13;
      }
      y -= 4;
    } else if (b.kind === "fields") {
      const labelW = 190;
      for (const [k, v] of b.rows) {
        const lines = wrap(v || "Not recorded", font, 10, width - labelW);
        ensure(13 * lines.length + 2);
        page.drawText(clean(k), { x: M, y, size: 9.5, font: bold, color: GREY });
        lines.forEach((l, i) => page.drawText(l, { x: M + labelW, y: y - i * 13, size: 10, font }));
        y -= 13 * lines.length + 3;
      }
      y -= 4;
    } else if (b.kind === "table") {
      const n = b.columns.length;
      const colW = width / n;
      const drawRow = (cells: string[], isHead: boolean) => {
        const wrapped = cells.map((c) => wrap(c ?? "", isHead ? bold : font, 8.5, colW - 6));
        const h = Math.max(...wrapped.map((w) => w.length)) * 11 + 4;
        ensure(h);
        if (isHead) page.drawRectangle({ x: M, y: y - h + 9, width, height: h, color: rgb(0.92, 0.94, 0.97) });
        wrapped.forEach((lines, i) => lines.forEach((l, j) => page.drawText(l, { x: M + i * colW + 3, y: y - j * 11, size: 8.5, font: isHead ? bold : font })));
        y -= h;
        page.drawLine({ start: { x: M, y: y + 8 }, end: { x: A4.w - M, y: y + 8 }, thickness: 0.3, color: GREY });
      };
      drawRow(b.columns, true);
      if (!b.rows.length) drawRow(["No records", ...Array(n - 1).fill("")], false);
      for (const r of b.rows) drawRow(r.map(String), false);
      y -= 8;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: A4.w - M - font.widthOfTextAtSize(t, 8), y: 24, size: 8, font, color: GREY });
    p.drawText("Official record generated from KATDICT SPIMP database records. Values marked 'Not recorded' were not captured.", { x: M, y: 24, size: 7, font, color: GREY });
  });
  return pdf.save();
}
