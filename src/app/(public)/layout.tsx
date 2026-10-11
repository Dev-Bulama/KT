import Link from "next/link";
import { Logo } from "@/components/layout/logo";

const nav = [
  { href: "/about", label: "About" },
  { href: "/services", label: "Service catalogue" },
  { href: "/contact", label: "Contact & support" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="no-underline" aria-label="KATDICT home"><Logo /></Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label="Main">
            {nav.map((n) => <Link key={n.href} href={n.href} className="text-ink no-underline hover:text-navy-700">{n.label}</Link>)}
            <Link href="/login" className="rounded-md bg-navy-900 px-3 py-1.5 text-white no-underline hover:bg-navy-800">Sign in</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 py-6 text-xs text-muted">
          <p>© {new Date().getFullYear()} Katsina State Directorate of Information and Communication Technology (KATDICT)</p>
          <nav className="flex gap-4" aria-label="Footer">
            <Link href="/privacy" className="text-muted">Privacy notice</Link>
            <Link href="/contact" className="text-muted">Support</Link>
            <Link href="/register" className="text-muted">MDA registration</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
