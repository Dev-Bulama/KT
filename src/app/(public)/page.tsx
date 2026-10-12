import Link from "next/link";
import { ArrowRight, BookOpen, Building2, ClipboardList, Clock, FolderKanban, LineChart, MessageSquare, ShieldCheck, Sparkles, Users } from "lucide-react";
import { getSiteContent } from "@/modules/site/content";

const ICONS = { ClipboardList, FolderKanban, LineChart, Sparkles, ShieldCheck, Users, Building2, MessageSquare, BookOpen, Clock };

export default async function Landing() {
  const c = await getSiteContent("home");
  return (
    <>
      <section className="bg-navy-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[1.4fr_1fr] md:py-20">
          <div>
            {c.eyebrow && <p className="text-sm font-medium uppercase tracking-wider text-navy-100">{c.eyebrow}</p>}
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-white md:text-4xl">{c.title}</h1>
            {c.intro && <p className="mt-4 max-w-xl whitespace-pre-line text-navy-100">{c.intro}</p>}
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-2.5 font-medium text-navy-950 no-underline hover:bg-navy-100">{c.primaryCtaLabel} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
              <Link href="/register" className="inline-flex items-center gap-2 rounded-md border border-white/40 px-5 py-2.5 font-medium text-white no-underline hover:bg-white/10">{c.secondaryCtaLabel}</Link>
            </div>
          </div>
          {c.steps.length > 0 && (
            <div className="rounded-xl border border-white/15 bg-white/5 p-6 text-sm">
              {c.howItWorksTitle && <p className="font-semibold text-white">{c.howItWorksTitle}</p>}
              <ol className="mt-4 space-y-3 text-navy-100">
                {c.steps.map((s, i) => (
                  <li key={i} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-bold text-white">{i + 1}</span>{s}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>
      {c.features.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          {c.featuresTitle && <h2 className="text-xl font-semibold">{c.featuresTitle}</h2>}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.features.map((f, i) => {
              const Icon = ICONS[f.icon] ?? ClipboardList;
              return (
                <div key={i} className="rounded-[var(--radius-card)] border border-line bg-white p-5">
                  <Icon className="h-6 w-6 text-navy-700" aria-hidden />
                  <h3 className="mt-3 font-semibold">{f.title}</h3>
                  {f.text && <p className="mt-1 text-sm text-muted">{f.text}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
