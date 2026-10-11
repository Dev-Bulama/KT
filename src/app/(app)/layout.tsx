import { AppShell } from "@/components/layout/app-shell";
import { requirePageActor } from "@/modules/auth/current";
import { unreadCount } from "@/modules/notifications/inbox";

// Authenticated area: never statically cached; responses carry private data.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor();
  const unread = await unreadCount(actor);
  return <AppShell actor={actor} unread={unread}>{children}</AppShell>;
}
