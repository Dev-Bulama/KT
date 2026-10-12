"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/about", label: "About" },
  { href: "/services", label: "Service catalogue" },
  { href: "/contact", label: "Contact & support" },
];

/** Public header navigation: inline links on wide screens, a menu button on phones. */
export function PublicNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    // Close the menu after navigating.
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const link = (n: (typeof NAV)[number], mobile = false) => (
    <Link
      key={n.href}
      href={n.href}
      aria-current={pathname === n.href ? "page" : undefined}
      className={cn(
        "no-underline",
        mobile ? "block rounded-md px-3 py-2.5 text-base text-ink hover:bg-navy-50" : "text-ink hover:text-navy-700",
        pathname === n.href && "font-medium text-navy-900",
      )}
    >
      {n.label}
    </Link>
  );

  return (
    <>
      <nav className="hidden items-center gap-5 text-sm md:flex" aria-label="Main">
        {NAV.map((n) => link(n))}
        <Link href="/login" className="rounded-md bg-navy-900 px-3 py-1.5 text-white no-underline hover:bg-navy-800">Sign in</Link>
      </nav>
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink md:hidden"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="public-mobile-menu"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>
      {open && (
        <nav id="public-mobile-menu" aria-label="Main" className="w-full border-t border-line pt-2 pb-1 md:hidden">
          {NAV.map((n) => link(n, true))}
          <div className="mt-2 grid grid-cols-2 gap-2 px-1">
            <Link href="/login" className="rounded-md bg-navy-900 px-3 py-2.5 text-center text-white no-underline hover:bg-navy-800">Sign in</Link>
            <Link href="/register" className="rounded-md border border-line px-3 py-2.5 text-center text-ink no-underline hover:bg-navy-50">Register MDA</Link>
          </div>
        </nav>
      )}
    </>
  );
}
