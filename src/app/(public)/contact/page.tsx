export const metadata = { title: "Contact and support" };

export default function Contact() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Contact and support</h1>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed">
        <p>For help with your account, a request or a project, signed-in users should use the project or request message thread so that the conversation is recorded. MDA administrators can also raise a formal complaint from <strong>Feedback &amp; complaints</strong>.</p>
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <p className="font-semibold">KATDICT Service Desk</p>
          <p className="mt-2 text-sm text-muted">Official contact details (address, telephone and support email) are configured by KATDICT administrators and must be confirmed before go-live. They are intentionally not invented in this build.</p>
        </div>
        <p className="text-sm text-muted">Never share your password or verification codes. KATDICT staff will never ask for them.</p>
      </div>
    </div>
  );
}
