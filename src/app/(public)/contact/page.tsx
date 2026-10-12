import { Markdown } from "@/components/shared/markdown";
import { getSiteContent } from "@/modules/site/content";

export async function generateMetadata() {
  return { title: (await getSiteContent("contact")).title };
}

export default async function Contact() {
  const c = await getSiteContent("contact");
  const details: [string, React.ReactNode][] = [
    ["Address", c.address ? <span className="whitespace-pre-line">{c.address}</span> : null],
    ["Telephone", c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a> : null],
    ["Email", c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null],
    ["Hours", c.hours || null],
  ];
  const shown = details.filter(([, v]) => v);
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{c.title}</h1>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed">
        {c.intro && <Markdown source={c.intro} />}
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          {c.deskName && <p className="font-semibold">{c.deskName}</p>}
          {shown.length ? (
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[120px_1fr]">
              {shown.map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted">Official contact details have not been published yet.</p>
          )}
        </div>
        {c.note && <Markdown source={c.note} className="text-sm text-muted" />}
      </div>
    </div>
  );
}
