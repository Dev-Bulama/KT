/**
 * Parser/validator for third-party chatbot embed snippets (e.g. the
 * `<script src="https://…/widget.js" data-…></script>` code that chatbot
 * providers give you). Pure and dependency-free so it can be unit-tested and
 * used by the client loader's types.
 *
 * Only <script> tags are accepted. Event-handler attributes, non-HTTPS
 * sources and unknown attributes are rejected. The https origins the widget
 * needs are derived so the Content-Security-Policy can allow exactly those.
 */
export interface ChatbotScript {
  src?: string;
  code?: string;
  attrs: Record<string, string>;
}

export interface ParsedSnippet {
  scripts: ChatbotScript[];
  origins: string[];
}

export const MAX_SNIPPET_LENGTH = 20_000;
const MAX_SCRIPTS = 5;
const BOOLEAN_ATTRS = new Set(["async", "defer", "nomodule"]);
const VALUE_ATTRS = new Set(["src", "type", "id", "crossorigin", "charset", "referrerpolicy", "integrity"]);
const ALLOWED_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

export class SnippetError extends Error {}

function decodeEntities(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Normalises an https URL (protocol-relative allowed) and returns it, or throws. */
export function httpsUrl(raw: string): URL {
  const value = raw.trim().startsWith("//") ? `https:${raw.trim()}` : raw.trim();
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new SnippetError(`"${raw}" is not a valid URL.`);
  }
  if (u.protocol !== "https:") throw new SnippetError(`Scripts must load over HTTPS ("${raw}").`);
  if (u.username || u.password) throw new SnippetError("Script URLs must not contain credentials.");
  return u;
}

/** Validates an additional allowed domain entered by the administrator; returns its https origin. */
export function normaliseOrigin(raw: string): string {
  const v = raw.trim();
  if (!v) throw new SnippetError("Empty domain.");
  const withScheme = /^[a-z]+:\/\//i.test(v) ? v.replace(/^wss:/i, "https:") : `https://${v}`;
  const u = httpsUrl(withScheme);
  if (u.pathname !== "/" || u.search || u.hash) throw new SnippetError(`Enter only a domain (e.g. https://widget.example.com), not a page address ("${raw}").`);
  if (u.hostname.startsWith("*")) throw new SnippetError("Wildcard domains are not allowed.");
  return u.origin;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    if (name.startsWith("on")) throw new SnippetError(`Event-handler attributes such as "${name}" are not allowed.`);
    if (BOOLEAN_ATTRS.has(name)) attrs[name] = "";
    else if (VALUE_ATTRS.has(name) || /^data-[a-z0-9_.:-]+$/.test(name)) attrs[name] = value;
    else throw new SnippetError(`The attribute "${name}" is not supported in chatbot scripts.`);
  }
  return attrs;
}

export function parseChatbotSnippet(snippet: string): ParsedSnippet {
  if (snippet.length > MAX_SNIPPET_LENGTH) throw new SnippetError(`The snippet is too long (maximum ${MAX_SNIPPET_LENGTH.toLocaleString()} characters).`);
  const withoutComments = snippet.replace(/<!--[\s\S]*?-->/g, "");
  const scripts: ChatbotScript[] = [];
  const origins = new Set<string>();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let rest = withoutComments;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments))) {
    rest = rest.replace(m[0], "");
    const attrs = parseAttrs(m[1]);
    const type = (attrs.type ?? "").toLowerCase();
    if (!ALLOWED_TYPES.has(type)) throw new SnippetError(`Script type "${attrs.type}" is not supported.`);
    if (attrs.src !== undefined) {
      const u = httpsUrl(attrs.src);
      origins.add(u.origin);
      const { src: _src, ...others } = attrs;
      void _src;
      scripts.push({ src: u.href, attrs: others });
    } else {
      const code = m[2].trim();
      if (!code) continue;
      if (/<\/?script/i.test(code)) throw new SnippetError("Nested <script> tags are not supported.");
      // Origins referenced by inline loader code (e.g. a script it injects).
      for (const url of code.match(/(?:https:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?/gi) ?? []) {
        try {
          origins.add(httpsUrl(url).origin);
        } catch {
          /* ignore non-https references */
        }
      }
      scripts.push({ code, attrs });
    }
  }
  if (rest.trim()) {
    throw new SnippetError("Only <script> tags are supported. Remove any other HTML (for example <div>, <iframe> or <link> tags) from the snippet.");
  }
  if (!scripts.length) throw new SnippetError("No <script> tag was found in the snippet.");
  if (scripts.length > MAX_SCRIPTS) throw new SnippetError(`At most ${MAX_SCRIPTS} script tags are supported.`);
  return { scripts, origins: [...origins].sort() };
}
