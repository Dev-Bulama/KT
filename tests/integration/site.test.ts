import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { prisma, resetDb, makeMda, makeUser } from "./helpers";
import type { Actor } from "@/modules/rbac/actor";
import { EMAIL_CONFIG_KEY, getEmailConfigView, invalidateEmailProviderCache, saveEmailConfig, sendTestEmail } from "@/modules/notifications/email-config";
import { processOutbox } from "@/modules/notifications/service";
import { getChatbotRuntime, invalidateChatbotCache, saveChatbotConfig } from "@/modules/site/chatbot";
import { getLogoAsset, getSiteContent, removeLogo, resetSiteContent, saveSiteContent, uploadLogo } from "@/modules/site/content";
import { SECTIONS } from "@/modules/site/content-schema";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe("admin site configuration", () => {
  let superAdmin: Actor, ops: Actor, mdaAdmin: Actor, auditor: Actor;
  let smtp: SMTPServer;
  let port = 0;
  const received: { from: string; to: string[]; raw: string; user?: string }[] = [];

  beforeAll(async () => {
    await resetDb();
    const mda = await makeMda("SIT");
    superAdmin = await makeUser("SUPER_ADMIN");
    ops = await makeUser("OPERATIONS_ADMIN");
    mdaAdmin = await makeUser("MDA_ADMIN", { mdaId: mda.id });
    auditor = await makeUser("AUDITOR");
    // Local SMTP server requiring authentication (plaintext is allowed outside production).
    smtp = new SMTPServer({
      secure: false,
      disabledCommands: ["STARTTLS"],
      authMethods: ["PLAIN", "LOGIN"],
      allowInsecureAuth: true,
      onAuth(auth, _session, cb) {
        if (auth.username === "mailer@katdict.test" && auth.password === "Correct-Horse-1") cb(null, { user: auth.username });
        else cb(new Error("Invalid username or password"));
      },
      onData(stream, session, cb) {
        let raw = "";
        stream.on("data", (c: Buffer) => (raw += c.toString()));
        stream.on("end", () => {
          received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw, user: session.user as string | undefined });
          cb();
        });
      },
    });
    await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", () => resolve()));
    port = (smtp.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    invalidateEmailProviderCache();
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  });

  describe("SMTP email delivery", () => {
    const config = () => ({ mode: "smtp", host: "127.0.0.1", port, security: "none", username: "mailer@katdict.test", password: "Correct-Horse-1", fromName: "KATDICT Service Desk", fromEmail: "desk@katdict.test", replyTo: "" });

    it("only administrators with notification permission can configure email", async () => {
      await expect(saveEmailConfig(ops, config())).rejects.toThrow(/not authorised/);
      await expect(saveEmailConfig(mdaAdmin, config())).rejects.toThrow(/not authorised/);
      await expect(getEmailConfigView(auditor)).rejects.toThrow(/not authorised/);
    });

    it("validates the settings", async () => {
      await expect(saveEmailConfig(superAdmin, { ...config(), host: "bad host!" })).rejects.toMatchObject({ fieldErrors: { host: [expect.any(String)] } });
      await expect(saveEmailConfig(superAdmin, { ...config(), fromEmail: "nope" })).rejects.toMatchObject({ fieldErrors: { fromEmail: [expect.any(String)] } });
      await expect(saveEmailConfig(superAdmin, { ...config(), port: 70000 })).rejects.toMatchObject({ fieldErrors: { port: [expect.any(String)] } });
    });

    it("stores the password encrypted and never returns it", async () => {
      await saveEmailConfig(superAdmin, config());
      const row = await prisma.systemSetting.findUniqueOrThrow({ where: { key: EMAIL_CONFIG_KEY } });
      expect(JSON.stringify(row.value)).not.toContain("Correct-Horse-1");
      const view = await getEmailConfigView(superAdmin);
      expect(view).toMatchObject({ mode: "smtp", host: "127.0.0.1", hasPassword: true });
      expect(JSON.stringify(view)).not.toContain("Correct-Horse-1");
      expect(JSON.stringify(view)).not.toContain("passwordEnc");
      const auditRows = await prisma.auditEvent.findMany({ where: { action: "settings.email.update" } });
      expect(auditRows).toHaveLength(1);
      expect(JSON.stringify({ before: auditRows[0].before, after: auditRows[0].after })).not.toContain("Correct-Horse-1");
      expect(JSON.stringify(auditRows[0].after)).not.toContain("passwordEnc");
    });

    it("sends a test email through the SMTP server with authentication", async () => {
      const r = await sendTestEmail(superAdmin, "officer@katdict.test");
      expect(r.provider).toBe("smtp");
      const msg = received.at(-1)!;
      expect(msg.user).toBe("mailer@katdict.test");
      expect(msg.from).toBe("desk@katdict.test");
      expect(msg.to).toEqual(["officer@katdict.test"]);
      expect(msg.raw).toContain("Subject: KATDICT SPIMP test email");
      expect(msg.raw).toContain("KATDICT Service Desk");
    });

    it("delivers queued notification emails via SMTP", async () => {
      await prisma.outboxEvent.create({ data: { kind: "email", payload: { to: "mda@katdict.test", subject: "Queued notice", text: "Hello" } } });
      const before = received.length;
      const r = await processOutbox(10);
      expect(r).toEqual({ sent: 1, failed: 0 });
      expect(received.length).toBe(before + 1);
      expect(received.at(-1)!.to).toEqual(["mda@katdict.test"]);
    });

    it("keeps the saved password when the field is left blank, and reports server errors", async () => {
      await saveEmailConfig(superAdmin, { ...config(), password: "" });
      await expect(sendTestEmail(superAdmin, "officer@katdict.test")).resolves.toEqual({ provider: "smtp" });
      await saveEmailConfig(superAdmin, { ...config(), password: "Wrong-Password" });
      await expect(sendTestEmail(superAdmin, "officer@katdict.test")).rejects.toThrow(/Test email failed \(smtp\)/);
      await saveEmailConfig(superAdmin, { ...config(), clearPassword: true });
      expect((await getEmailConfigView(superAdmin)).hasPassword).toBe(false);
    });

    it("falls back to the environment provider in env mode", async () => {
      await saveEmailConfig(superAdmin, { ...config(), mode: "env" });
      await expect(sendTestEmail(superAdmin, "officer@katdict.test")).resolves.toEqual({ provider: "console" });
    });
  });

  describe("website content (CMS)", () => {
    it("requires site.content.manage", async () => {
      const value = { ...SECTIONS.about.defaults, title: "Hacked" };
      for (const a of [ops, mdaAdmin, auditor]) await expect(saveSiteContent(a, "about", value)).rejects.toThrow(/not authorised/);
      expect((await getSiteContent("about")).title).toBe(SECTIONS.about.defaults.title);
    });

    it("publishes validated content, audits it, and can restore defaults", async () => {
      await saveSiteContent(superAdmin, "about", { title: "About KATDICT", body: "## Mission\n\nServing MDAs." });
      expect(await getSiteContent("about")).toEqual({ title: "About KATDICT", body: "## Mission\n\nServing MDAs." });
      expect(await prisma.auditEvent.count({ where: { action: "site.content.update", entityId: "about" } })).toBe(1);
      await resetSiteContent(superAdmin, "about");
      expect((await getSiteContent("about")).title).toBe(SECTIONS.about.defaults.title);
    });

    it("rejects invalid values (unsafe links, missing required text, unknown fields are dropped)", async () => {
      await expect(saveSiteContent(superAdmin, "announcement", { enabled: true, tone: "info", text: "Hi", linkLabel: "Go", linkUrl: "javascript:alert(1)" })).rejects.toMatchObject({ fieldErrors: { linkUrl: [expect.any(String)] } });
      await expect(saveSiteContent(superAdmin, "about", { title: "", body: "x" })).rejects.toMatchObject({ fieldErrors: { title: [expect.any(String)] } });
      await saveSiteContent(superAdmin, "services", { title: "Services", intro: "x", injected: "<script>" });
      expect(await getSiteContent("services")).toEqual({ title: "Services", intro: "x" });
    });

    it("permission can be delegated to another role", async () => {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "OPERATIONS_ADMIN" } });
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "site.content.manage" } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      const { actor } = await import("./helpers");
      const opsNow = (await actor(ops.id))!;
      await saveSiteContent(opsNow, "contact", { ...SECTIONS.contact.defaults, phone: "+234 000 000 0000" });
      expect((await getSiteContent("contact")).phone).toBe("+234 000 000 0000");
    });
  });

  describe("logo upload", () => {
    const file = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name);

    it("accepts a PNG from an authorised user and stores it", async () => {
      await expect(uploadLogo(auditor, file(PNG, "logo.png"))).rejects.toThrow(/not authorised/);
      await uploadLogo(superAdmin, file(PNG, "logo.png"));
      const asset = await getLogoAsset();
      expect(asset?.mime).toBe("image/png");
      expect(asset?.sizeBytes).toBe(PNG.length);
    });

    it("rejects SVG, disguised files and oversized images", async () => {
      await expect(uploadLogo(superAdmin, file(new TextEncoder().encode("<svg><script>alert(1)</script></svg>"), "logo.png"))).rejects.toThrow(/PNG, JPEG or WebP/);
      const big = new Uint8Array(1024 * 1024 + 1);
      big.set(PNG);
      await expect(uploadLogo(superAdmin, file(big, "big.png"))).rejects.toThrow(/1 MB/);
      await expect(uploadLogo(superAdmin, null)).rejects.toThrow(/Choose an image/);
    });

    it("can be removed", async () => {
      await removeLogo(superAdmin);
      expect(await getLogoAsset()).toBeNull();
      expect(await prisma.auditEvent.count({ where: { action: { in: ["site.logo.upload", "site.logo.remove"] } } })).toBe(2);
    });
  });

  describe("chatbot widget", () => {
    const snippet = `<script src="https://skillychat.com.ng/widget.js" data-bot-id="demo" defer></script>`;

    it("is restricted to system.settings.manage", async () => {
      await expect(saveChatbotConfig(ops, { enabled: true, snippet, scope: "public" })).rejects.toThrow(/not authorised/);
      await expect(saveChatbotConfig(mdaAdmin, { enabled: true, snippet, scope: "public" })).rejects.toThrow(/not authorised/);
    });

    it("validates the snippet and exposes only derived scripts and origins at runtime", async () => {
      await expect(saveChatbotConfig(superAdmin, { enabled: true, snippet: `<script src="http://x.example/a.js"></script>`, scope: "public" })).rejects.toMatchObject({ fieldErrors: { snippet: [expect.stringMatching(/HTTPS/)] } });
      await expect(saveChatbotConfig(superAdmin, { enabled: true, snippet: "", scope: "public" })).rejects.toThrow(/Paste the widget/);
      await expect(saveChatbotConfig(superAdmin, { enabled: true, snippet, scope: "public", extraOrigins: "http://insecure.example" })).rejects.toMatchObject({ fieldErrors: { extraOrigins: [expect.any(String)] } });

      await saveChatbotConfig(superAdmin, { enabled: true, provider: "SkillyChat", snippet, scope: "public", extraOrigins: "api.skillychat.com.ng" });
      invalidateChatbotCache();
      const rt = await getChatbotRuntime();
      expect(rt).toMatchObject({ enabled: true, scope: "public" });
      expect(rt.scripts).toEqual([{ src: "https://skillychat.com.ng/widget.js", attrs: { "data-bot-id": "demo", defer: "" } }]);
      expect(rt.origins.sort()).toEqual(["https://api.skillychat.com.ng", "https://skillychat.com.ng"]);

      await saveChatbotConfig(superAdmin, { enabled: false, snippet, scope: "public" });
      invalidateChatbotCache();
      expect((await getChatbotRuntime()).enabled).toBe(false);
      expect(await prisma.auditEvent.count({ where: { action: "settings.chatbot.update" } })).toBe(2);
    });
  });
});
