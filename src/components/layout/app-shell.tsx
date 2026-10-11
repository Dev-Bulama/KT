import Link from "next/link";
import { Bell, LogOut, Menu, Search, ShieldCheck, UserCircle2 } from "lucide-react";
import type { Actor } from "@/modules/rbac/actor";
import { humanize } from "@/lib/utils";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "./logo";
import { visibleNav } from "./nav";
import { SidebarLinks } from "./sidebar-links";

export function AppShell({ actor, unread, children }: { actor: Actor; unread: number; children: React.ReactNode }) {
  const sections = visibleNav(actor);
  const roleLabel = actor.roles.map(humanize).join(", ");
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden bg-navy-950 px-3 py-4 lg:block no-print">
        <div className="px-2 pb-5"><Link href="/dashboard" className="no-underline" aria-label="Dashboard"><Logo light /></Link></div>
        <SidebarLinks sections={sections} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur no-print">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <details className="relative lg:hidden">
              <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-line" aria-label="Open navigation"><Menu className="h-5 w-5" /></summary>
              <div className="absolute left-0 top-11 z-40 max-h-[80vh] w-72 overflow-y-auto rounded-md bg-navy-950 p-3 shadow-xl">
                <SidebarLinks sections={sections} />
              </div>
            </details>
            <form action="/search" method="get" role="search" className="relative flex-1 max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
              <label htmlFor="global-search" className="sr-only">Search requests, projects, MDAs and knowledge</label>
              <input id="global-search" name="q" placeholder="Search references, projects, MDAs, knowledge…" className="h-9 w-full rounded-md border border-line bg-canvas pl-9 pr-3 text-sm focus:border-navy-700 focus:bg-white focus:outline-none" />
            </form>
            <Link href="/notifications" className="relative flex h-9 w-9 items-center justify-center rounded-md border border-line text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-danger-700 px-1.5 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-line px-2 py-1.5 text-sm">
                <UserCircle2 className="h-5 w-5 text-navy-700" aria-hidden />
                <span className="hidden max-w-[160px] truncate sm:inline">{actor.name}</span>
              </summary>
              <div className="absolute right-0 top-11 z-40 w-72 rounded-md border border-line bg-white p-2 text-sm shadow-lg">
                <div className="border-b border-line px-2 pb-2">
                  <p className="font-medium">{actor.name}</p>
                  <p className="truncate text-xs text-muted">{actor.email}</p>
                  <p className="mt-1 text-xs text-muted">{roleLabel}{actor.mdaName ? ` · ${actor.mdaName}` : ""}</p>
                </div>
                <Link href="/account/security" className="mt-1 flex items-center gap-2 rounded px-2 py-1.5 text-ink no-underline hover:bg-navy-50"><ShieldCheck className="h-4 w-4" aria-hidden />Account &amp; security</Link>
                <Link href="/notifications?tab=preferences" className="flex items-center gap-2 rounded px-2 py-1.5 text-ink no-underline hover:bg-navy-50"><Bell className="h-4 w-4" aria-hidden />Notification preferences</Link>
                <form action={logoutAction}>
                  <button type="submit" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-danger-700 hover:bg-danger-100"><LogOut className="h-4 w-4" aria-hidden />Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
