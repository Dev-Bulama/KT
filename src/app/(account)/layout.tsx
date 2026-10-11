import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { logoutAction } from "@/app/(auth)/actions";

// Separate from the main app layout so that users who must enrol MFA can reach it.
export const dynamic = "force-dynamic";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="no-underline"><Logo /></Link>
          <div className="flex items-center gap-4 text-sm"><Link href="/dashboard">Back to dashboard</Link><form action={logoutAction}><button className="text-danger-700">Sign out</button></form></div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
