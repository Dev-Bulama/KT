export const metadata = { title: "About the platform" };

export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">About the platform</h1>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed">
        <p>The KATDICT Service &amp; Project Intelligence Management Platform (KATDICT-SPIMP) is the Katsina State Government&apos;s central channel through which Ministries, Departments and Agencies (MDAs) request ICT services and projects from the Directorate of Information and Communication Technology.</p>
        <p>It records every request from submission to final delivery: assessment, approval, assignment of responsible officers, milestones, deliverables, formal MDA acceptance and closure. Each project keeps a permanent <strong>Digital Project Passport</strong> and a <strong>Decision Trail</strong> showing who decided what, when and why.</p>
        <p>KATDICT leadership uses the platform&apos;s dashboards, scorecards and early-warning centre to monitor delivery across the State. AI-assisted features help staff classify requests, check completeness and draft plans and reports — but every decision remains with an authorised human officer, and AI can be switched off entirely where external processing is not approved.</p>
        <h2 className="pt-4 text-lg font-semibold">Status of this system</h2>
        <p className="text-muted">This software has been developed for a controlled pilot. Development completion is distinct from formal government acceptance, security certification and production authorisation, which are granted by the appropriate Katsina State authorities.</p>
      </div>
    </div>
  );
}
