import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers";
import { getStorage, setStorage, storageDriverKind } from "@/modules/files/storage";

describe("database storage driver", () => {
  const prev = process.env.STORAGE_DRIVER;
  afterAll(() => {
    process.env.STORAGE_DRIVER = prev;
    setStorage(null);
  });

  it("stores and returns file contents in PostgreSQL and streams downloads through the app", async () => {
    process.env.STORAGE_DRIVER = "database";
    setStorage(null);
    expect(storageDriverKind()).toBe("database");
    const s = getStorage();
    const bytes = new TextEncoder().encode("%PDF-1.7 test");
    await s.put("test/abc.pdf", bytes, "application/pdf");
    expect(Array.from(await s.get("test/abc.pdf"))).toEqual(Array.from(bytes));
    expect(await s.signedDownloadUrl("test/abc.pdf", "a.pdf", "application/pdf", 60)).toBeNull();
    expect((await prisma.storageObject.findUniqueOrThrow({ where: { key: "test/abc.pdf" } })).sizeBytes).toBe(bytes.length);
    await expect(s.get("missing")).rejects.toThrow(/not found/);
  });

  it("defaults to database storage in production when STORAGE_DRIVER is not set", () => {
    delete process.env.STORAGE_DRIVER;
    const nodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      expect(storageDriverKind()).toBe("database");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
    }
  });
});
