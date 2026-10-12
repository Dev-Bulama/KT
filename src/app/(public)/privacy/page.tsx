import { Markdown } from "@/components/shared/markdown";
import { getSiteContent } from "@/modules/site/content";

export async function generateMetadata() {
  return { title: (await getSiteContent("privacy")).title };
}

export default async function Privacy() {
  const c = await getSiteContent("privacy");
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{c.title}</h1>
      {c.subtitle && <p className="mt-2 text-sm text-muted">{c.subtitle}</p>}
      <Markdown source={c.body} className="mt-6 space-y-4 text-[15px] leading-relaxed" />
    </div>
  );
}
