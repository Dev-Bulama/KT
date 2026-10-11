import Link from "next/link";
import { ArrowRight, ClipboardList, FolderKanban, LineChart, ShieldCheck, Sparkles, Users } from "lucide-react";

const features = [
  { icon: ClipboardList, title: "Request ICT services", text: "A guided request wizard with a permanent reference, transparent status tracking and clarification messaging." },
  { icon: FolderKanban, title: "Accountable delivery", text: "Assigned officers, acknowledged assignments, milestones, change control and formal MDA acceptance before closure." },
  { icon: LineChart, title: "Delivery intelligence", text: "Service-level tracking, scorecards with published metric definitions, and an early-warning centre." },
  { icon: Sparkles, title: "AI assistance, human decisions", text: "Classification, quality checks and planning drafts for staff review. AI never approves, assigns or closes work." },
  { icon: ShieldCheck, title: "Audit and decision trail", text: "Every significant decision is recorded with actor, time, reason and previous state in a tamper-evident log." },
  { icon: Users, title: "Built for 120 MDAs", text: "Institutional accounts, strict separation between MDAs, and role-based access for every user." },
];

export default function Landing() {
  return (
    <>
      <section className="bg-navy-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[1.4fr_1fr] md:py-20">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-navy-100">Katsina State Directorate of ICT</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-white md:text-4xl">Service &amp; Project Intelligence Management Platform</h1>
            <p className="mt-4 max-w-xl text-navy-100">One accountable channel for Ministries, Departments and Agencies to request ICT services, follow delivery from submission to acceptance, and give feedback — with statewide intelligence for KATDICT leadership.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-2.5 font-medium text-navy-950 no-underline hover:bg-navy-100">Sign in <ArrowRight className="h-4 w-4" aria-hidden /></Link>
              <Link href="/register" className="inline-flex items-center gap-2 rounded-md border border-white/40 px-5 py-2.5 font-medium text-white no-underline hover:bg-white/10">Register your MDA</Link>
            </div>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/5 p-6 text-sm">
            <p className="font-semibold text-white">How it works</p>
            <ol className="mt-4 space-y-3 text-navy-100">
              {["Register and verify your MDA", "Submit a service request", "KATDICT assesses and approves", "An officer is assigned and delivers", "Your MDA reviews and accepts", "The project is closed with a completion report"].map((s, i) => (
                <li key={s} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-bold text-white">{i + 1}</span>{s}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-xl font-semibold">What the platform provides</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-[var(--radius-card)] border border-line bg-white p-5">
              <f.icon className="h-6 w-6 text-navy-700" aria-hidden />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
