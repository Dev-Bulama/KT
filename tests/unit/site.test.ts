import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCsp } from "@/lib/csp";
import { chatbotAllowedOn } from "@/lib/site-paths";
import { normaliseOrigin, parseChatbotSnippet, SnippetError } from "@/modules/site/chatbot-snippet";
import { contentFromForm, safeLink, SECTION_KEYS, SECTIONS, sniffLogo } from "@/modules/site/content-schema";
import { isSafeHref, Markdown } from "@/components/shared/markdown";

describe("chatbot snippet parser", () => {
  it("accepts a typical provider embed and derives its origin", () => {
    const r = parseChatbotSnippet(`<!-- Chat widget -->\n<script src="https://skillychat.com.ng/widget.js" data-bot-id="abc123" defer></script>`);
    expect(r.scripts).toEqual([{ src: "https://skillychat.com.ng/widget.js", attrs: { "data-bot-id": "abc123", defer: "" } }]);
    expect(r.origins).toEqual(["https://skillychat.com.ng"]);
  });

  it("keeps inline config and loader scripts in order and collects referenced https origins", () => {
    const r = parseChatbotSnippet(`<script>window.chatConfig = { id: "x" };</script>
<script>(function(){var s=document.createElement("script");s.src="https://cdn.widget.example/loader.js";document.head.appendChild(s);})();</script>`);
    expect(r.scripts).toHaveLength(2);
    expect(r.scripts[0].code).toContain("chatConfig");
    expect(r.origins).toEqual(["https://cdn.widget.example"]);
  });

  it("normalises protocol-relative sources to https", () => {
    expect(parseChatbotSnippet(`<script src="//w.example.com/a.js"></script>`).scripts[0].src).toBe("https://w.example.com/a.js");
  });

  it.each([
    [`<script src="http://w.example.com/a.js"></script>`, /HTTPS/],
    [`<script src="javascript:alert(1)"></script>`, /HTTPS/],
    [`<script src="https://w.example.com/a.js" onload="steal()"></script>`, /Event-handler/],
    [`<script src="https://w.example.com/a.js" style="x"></script>`, /not supported/],
    [`<script type="text/template">x</script>`, /type/],
    [`<div id="chat"></div><script src="https://w.example.com/a.js"></script>`, /Only <script> tags/],
    [`<iframe src="https://evil.example"></iframe>`, /Only <script> tags/],
    [`<img src=x onerror=alert(1)>`, /Only <script> tags/],
    [`hello`, /Only <script> tags/],
    [``, /No <script>/],
    [`<script src="https://user:pw@w.example.com/a.js"></script>`, /credentials/],
  ])("rejects %s", (snippet, msg) => {
    expect(() => parseChatbotSnippet(snippet)).toThrow(msg);
  });

  it("rejects oversized snippets and too many scripts", () => {
    expect(() => parseChatbotSnippet("<script>" + "x".repeat(21_000) + "</script>")).toThrow(SnippetError);
    expect(() => parseChatbotSnippet(Array.from({ length: 6 }, (_, i) => `<script>var a${i}=1</script>`).join(""))).toThrow(/At most/);
  });

  it("validates additional domains", () => {
    expect(normaliseOrigin("api.widget.example")).toBe("https://api.widget.example");
    expect(normaliseOrigin("wss://rt.widget.example")).toBe("https://rt.widget.example");
    expect(() => normaliseOrigin("http://x.example")).toThrow(/HTTPS/);
    expect(() => normaliseOrigin("https://x.example/path")).toThrow(/only a domain/);
  });
});

describe("content security policy", () => {
  it("allows only self by default", () => {
    const csp = buildCsp();
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("adds approved widget origins (and their websocket form) and ignores malformed ones", () => {
    const csp = buildCsp(["https://skillychat.com.ng", "https://evil.example; script-src *", "http://plain.example"]);
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://skillychat.com.ng");
    expect(csp).toContain("connect-src 'self' https://skillychat.com.ng wss://skillychat.com.ng");
    expect(csp).toContain("frame-src 'self' https://skillychat.com.ng");
    expect(csp).not.toContain("evil.example");
    expect(csp).not.toContain("plain.example");
  });

  it("limits where the widget may run", () => {
    expect(chatbotAllowedOn("/", "public")).toBe(true);
    expect(chatbotAllowedOn("/contact", "public")).toBe(true);
    for (const p of ["/login", "/register", "/forgot-password", "/dashboard"]) expect(chatbotAllowedOn(p, "public")).toBe(false);
    expect(chatbotAllowedOn("/dashboard", "public_and_app")).toBe(true);
    expect(chatbotAllowedOn("/projects/abc", "public_and_app")).toBe(true);
    for (const p of ["/login", "/register", "/account/security", "/admin/users", "/admin"]) expect(chatbotAllowedOn(p, "public_and_app")).toBe(false);
  });
});

describe("CMS content", () => {
  it("ships defaults that satisfy every section schema", () => {
    for (const k of SECTION_KEYS) expect(SECTIONS[k].schema.safeParse(SECTIONS[k].defaults).success, k).toBe(true);
  });

  it("builds section values from form data", () => {
    const fd = new FormData();
    fd.set("title", "Welcome");
    fd.set("eyebrow", "");
    fd.set("intro", "Line 1\r\nLine 2");
    fd.set("primaryCtaLabel", "Sign in");
    fd.set("secondaryCtaLabel", "Register");
    fd.set("howItWorksTitle", "Steps");
    fd.set("steps", "One\n\n Two \n");
    fd.set("featuresTitle", "Features");
    fd.set("features.0.title", "A");
    fd.set("features.0.text", "a");
    fd.set("features.0.icon", "Users");
    fd.set("features.1.title", "");
    fd.set("features.2.title", "C");
    fd.set("features.2.icon", "<script>");
    const v = contentFromForm("home", fd);
    expect(v.intro).toBe("Line 1\nLine 2");
    expect(v.steps).toEqual(["One", "Two"]);
    expect(v.features).toEqual([{ title: "A", text: "a", icon: "Users" }, { title: "C", text: "", icon: "ClipboardList" }]);
    expect(SECTIONS.home.schema.safeParse(v).success).toBe(true);
  });

  it("only accepts safe banner links", () => {
    for (const ok of ["", "/contact", "https://katsinastate.gov.ng/news", "mailto:help@example.gov.ng"]) expect(safeLink.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "//evil.example", "/\\evil.example", "http://plain.example", "data:text/html,x"]) expect(safeLink.safeParse(bad).success, bad).toBe(false);
  });

  it("detects logo formats by signature and rejects SVG/HTML", () => {
    expect(sniffLogo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffLogo(new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8 "))).toBe("image/webp");
    expect(sniffLogo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffLogo(new TextEncoder().encode("<html>"))).toBeNull();
  });
});

describe("safe markdown", () => {
  const html = (source: string) => renderToStaticMarkup(createElement(Markdown, { source }));

  it("renders headings, lists, emphasis and safe links", () => {
    const out = html("## Title\n\nSome **bold** and *italic* text with a [link](/contact).\n\n- one\n- two\n\n1. first\n2. second");
    expect(out).toContain("<h2");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain('<a href="/contact">link</a>');
    expect(out).toContain("<ul");
    expect(out).toContain("<ol");
  });

  it("never renders raw HTML or unsafe links", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> [click](javascript:alert(1)) [x](//evil.example)');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain('href="//evil.example"');
    expect(isSafeHref("https://example.gov.ng")).toBe(true);
    expect(isSafeHref("tel:+234 800 000 0000")).toBe(true);
    expect(isSafeHref("data:text/html,x")).toBe(false);
  });
});
