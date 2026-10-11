import Link from "next/link";
import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <Link href="/" className="mb-6 no-underline" aria-label="KATDICT home"><Logo /></Link>
      <main id="main" className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-sm sm:p-8">{children}</main>
      <p className="mt-6 max-w-md text-center text-xs text-muted">Authorised use only. Activity on this government system is logged.</p>
    </div>
  );
}
