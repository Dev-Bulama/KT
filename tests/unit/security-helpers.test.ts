import { describe, expect, it } from "vitest";
import { parseCsv, sanitizeCell, toCsv } from "@/lib/csv";
import { safeRedirectPath } from "@/lib/utils";
import { sniffFileType, safeFileName } from "@/modules/files/sniff";
import { canonical, computeAuditHash } from "@/modules/audit/audit";
import { decrypt, encrypt } from "@/lib/crypto";

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection", () => {
    expect(sanitizeCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(sanitizeCell("+1")).toBe("'+1");
    expect(sanitizeCell("-2")).toBe("'-2");
    expect(sanitizeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeCell("plain")).toBe("plain");
  });
  it("round-trips quoted fields", () => {
    const csv = toCsv(["a", "b"], [["x, y", 'say "hi"'], ["multi\nline", null]]);
    expect(parseCsv(csv)).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["multi\nline", ""]]);
  });
});

describe("open redirect protection", () => {
  it("only allows same-origin relative paths", () => {
    expect(safeRedirectPath("/projects/1")).toBe("/projects/1");
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/ok\r\nSet-Cookie: x")).toBe("/dashboard");
  });
});

describe("file type sniffing", () => {
  it("detects by signature, not by name", () => {
    expect(sniffFileType(new TextEncoder().encode("%PDF-1.7 ..."), "report.exe")?.ext).toBe("pdf");
    expect(sniffFileType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]), "innocent.pdf")).toBeNull(); // Windows executable
    expect(sniffFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "a.png")?.mime).toBe("image/png");
    expect(sniffFileType(new TextEncoder().encode("a,b\n1,2"), "data.csv")?.ext).toBe("csv");
  });
  it("sanitises file names", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\x\\<script>.pdf")).toBe("_script_.pdf");
  });
});

describe("audit hash chain", () => {
  it("canonical JSON is key-order independent", () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("hash changes when any field changes", () => {
    const rec = { actorId: "u", action: "x", entityType: "E", entityId: "1", before: null, after: { s: 1 }, reason: null, correlationId: "c", createdAt: new Date(0), prevHash: null };
    const h = computeAuditHash(rec);
    expect(computeAuditHash({ ...rec, after: { s: 2 } })).not.toBe(h);
    expect(computeAuditHash({ ...rec, prevHash: "abc" })).not.toBe(h);
    expect(computeAuditHash({ ...rec })).toBe(h);
  });
});

describe("secret encryption", () => {
  it("round-trips and detects tampering", () => {
    process.env.AUTH_SECRET = "unit-test-secret-0123456789abcdef0123456789";
    const enc = encrypt("JBSWY3DPEHPK3PXP");
    expect(decrypt(enc)).toBe("JBSWY3DPEHPK3PXP");
    const parts = enc.split(".");
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});
