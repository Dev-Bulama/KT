import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown for CMS content. Supports headings (## / ###),
 * paragraphs, bulleted and numbered lists, **bold**, *italic* and
 * [links](/path | https://… | mailto:… | tel:…). Raw HTML is never
 * interpreted: everything is rendered as React text nodes.
 */
export function isSafeHref(href: string): boolean {
  return /^\/(?![\/\\])\S*$/.test(href) || /^https:\/\/\S+$/i.test(href) || /^mailto:\S+$/i.test(href) || /^tel:[+\d\s()-]+$/i.test(href);
}

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${n++}`;
    if (m[1] !== undefined) {
      const href = m[2];
      if (isSafeHref(href)) {
        const external = href.startsWith("https://");
        out.push(<a key={key} href={href} {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}>{m[1]}</a>);
      } else {
        out.push(<Fragment key={key}>{m[1]}</Fragment>);
      }
    } else if (m[3] !== undefined) {
      out.push(<strong key={key}>{m[3]}</strong>);
    } else {
      out.push(<em key={key}>{m[4] ?? m[5]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withBreaks(lines: string[], key: string): ReactNode[] {
  return lines.flatMap((l, i) => (i ? [<br key={`${key}-br${i}`} />, ...renderInline(l, `${key}-${i}`)] : renderInline(l, `${key}-${i}`)));
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className={className ?? "space-y-4 text-[15px] leading-relaxed"}>
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        const lines = block.split("\n");
        if (lines.length === 1 && /^###\s+/.test(block)) return <h3 key={key} className="pt-2 font-semibold">{renderInline(block.replace(/^###\s+/, ""), key)}</h3>;
        if (lines.length === 1 && /^##?\s+/.test(block)) return <h2 key={key} className="pt-4 text-lg font-semibold">{renderInline(block.replace(/^##?\s+/, ""), key)}</h2>;
        if (lines.every((l) => /^[-*]\s+/.test(l))) {
          return <ul key={key} className="list-disc space-y-1 pl-6">{lines.map((l, i) => <li key={i}>{renderInline(l.replace(/^[-*]\s+/, ""), `${key}-${i}`)}</li>)}</ul>;
        }
        if (lines.every((l) => /^\d+[.)]\s+/.test(l))) {
          return <ol key={key} className="list-decimal space-y-1 pl-6">{lines.map((l, i) => <li key={i}>{renderInline(l.replace(/^\d+[.)]\s+/, ""), `${key}-${i}`)}</li>)}</ol>;
        }
        // A heading line followed by text in the same block.
        if (/^##?#?\s+/.test(lines[0])) {
          const level = lines[0].startsWith("###") ? 3 : 2;
          const heading = renderInline(lines[0].replace(/^#+\s+/, ""), `${key}-h`);
          return (
            <Fragment key={key}>
              {level === 3 ? <h3 className="pt-2 font-semibold">{heading}</h3> : <h2 className="pt-4 text-lg font-semibold">{heading}</h2>}
              <p>{withBreaks(lines.slice(1), key)}</p>
            </Fragment>
          );
        }
        return <p key={key}>{withBreaks(lines, key)}</p>;
      })}
    </div>
  );
}
