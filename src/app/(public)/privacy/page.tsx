export const metadata = { title: "Privacy notice" };

export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Privacy notice</h1>
      <p className="mt-2 text-sm text-muted">Draft notice for review by KATDICT and the State&apos;s legal/data-protection officers before production use.</p>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed">
        <h2 className="text-lg font-semibold">What we collect</h2>
        <p>Official contact details of MDA representatives and staff (name, official email, telephone, designation), institutional profile information, the content of service requests and project records, uploaded documents, and security logs (sign-in times, IP address, browser type) needed to protect accounts.</p>
        <h2 className="text-lg font-semibold">Why we use it</h2>
        <p>To deliver and account for ICT services to Katsina State MDAs, to communicate about requests and projects, to produce performance and audit reports, and to secure the platform.</p>
        <h2 className="text-lg font-semibold">Who can see it</h2>
        <p>Each MDA can only see its own records. KATDICT staff see records according to their role. Auditors have read-only access for oversight. Internal KATDICT notes are never shown to MDA users.</p>
        <h2 className="text-lg font-semibold">AI processing</h2>
        <p>AI-assisted features are disabled unless KATDICT has approved an AI provider and the related data-handling arrangements. When enabled, only the minimum record content needed for a requested analysis is sent, and the platform does not authorise use of government data for model training.</p>
        <h2 className="text-lg font-semibold">Retention</h2>
        <p>Project and audit records are kept as official records according to the retention periods configured by KATDICT. Notifications and security logs are retained for shorter periods.</p>
        <h2 className="text-lg font-semibold">Your rights and contact</h2>
        <p>To correct your information or raise a privacy concern, contact KATDICT support via the Contact page.</p>
      </div>
    </div>
  );
}
