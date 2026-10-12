import Link from "next/link";
import { connection } from "next/server";
import { Logo } from "@/components/layout/logo";
import { ChatbotWidget } from "@/components/site/chatbot-widget";
import { PublicNav } from "@/components/site/public-nav";
import { getSiteContent } from "@/modules/site/content";


const bannerTone = {
  info: "bg-info-100 text-navy-950 border-navy-100",
  warning: "bg-warn-100 text-warn-700 border-amber-200",
  success: "bg-accent-100 text-accent-700 border-accent-100",
} as const;

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  await connection(); // content is edited in Admin › Website content; always render the latest
  const [branding, banner] = await Promise.all([getSiteContent("branding"), getSiteContent("announcement")]);
  return (
    <div className="flex min-h-screen flex-col">
      {banner.enabled && banner.text && (
        <div role="status" className={`border-b px-4 py-2 text-center text-sm ${bannerTone[banner.tone]}`}>
          {banner.text}
          {banner.linkUrl && banner.linkLabel && <> <a href={banner.linkUrl} className="font-medium underline">{banner.linkLabel}</a></>}
        </div>
      )}
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="min-w-0 no-underline" aria-label={`${branding.siteName} home`}><Logo /></Link>
          <PublicNav />
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted sm:flex-row sm:flex-wrap sm:justify-between">
          <p>© {new Date().getFullYear()} {branding.footerText}</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Footer">
            <Link href="/privacy" className="text-muted">Privacy notice</Link>
            <Link href="/contact" className="text-muted">Support</Link>
            <Link href="/register" className="text-muted">MDA registration</Link>
          </nav>
        </div>
      </footer>
      <ChatbotWidget area="public" />
    </div>
  );
}
