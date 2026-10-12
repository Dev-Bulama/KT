import { Markdown } from "@/components/shared/markdown";
import { getSiteContent } from "@/modules/site/content";

export async function generateMetadata() {
  return { title: (await getSiteContent("about")).title };
}

export default async function About() {
  const c = await getSiteContent("about");
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{c.title}</h1>
      <Markdown source={c.body} className="mt-6 space-y-4 text-[15px] leading-relaxed" />
    </div>
  );
}
