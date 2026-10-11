"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";
import type { ClientNavSection } from "./nav";

export function SidebarLinks({ sections }: { sections: ClientNavSection[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Application" className="space-y-5">
      {sections.map((s, i) => (
        <div key={i}>
          {s.label && <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-navy-100/60">{s.label}</p>}
          <ul className="space-y-0.5">
            {s.items.map((item) => {
              const active = path === item.href || path.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm no-underline", active ? "bg-white/15 font-medium text-white" : "text-navy-100 hover:bg-white/10 hover:text-white")}
                  >
                    <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
