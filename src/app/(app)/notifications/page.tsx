import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { getPreferences, listNotifications, markRead } from "@/modules/notifications/inbox";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/forms/action-form";
import { Pagination } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { markAllReadAction, preferencesAction } from "./actions";

export const metadata = { title: "Notifications" };

export default async function Notifications({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActor();
  const tab = sp.tab === "preferences" ? "preferences" : "inbox";
  if (tab === "preferences") {
    const prefs = await getPreferences(actor);
    return (
      <>
        <PageHeader title="Notification preferences" />
        <Tabs basePath="/notifications" active={tab} tabs={[{ key: "inbox", label: "Inbox" }, { key: "preferences", label: "Preferences" }]} />
        <Card><CardBody>
          <ActionForm action={preferencesAction} submitLabel="Save preferences">
            <table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr><th className="py-2">Event</th><th>Email</th><th>In-app</th></tr></thead>
              <tbody>{prefs.map((p) => (
                <tr key={p.type} className="border-t border-line"><td className="py-2">{p.label}{p.mandatory && <Badge tone="info" className="ml-2">Mandatory</Badge>}</td>
                  <td><input type="checkbox" name={`email:${p.type}`} defaultChecked={p.email} disabled={p.mandatory} aria-label={`Email for ${p.label}`} /></td>
                  <td><input type="checkbox" name={`app:${p.type}`} defaultChecked={p.inApp} disabled={p.mandatory} aria-label={`In-app for ${p.label}`} /></td></tr>
              ))}</tbody></table>
          </ActionForm>
        </CardBody></Card>
      </>
    );
  }
  const data = await listNotifications(actor, { unreadOnly: sp.unread === "1", page: Number(sp.page ?? 1) });
  // Opening the inbox marks the displayed page as read.
  const unreadIds = data.items.filter((n) => !n.readAt).map((n) => n.id);
  if (unreadIds.length) await markRead(actor, unreadIds);
  return (
    <>
      <PageHeader title="Notifications" description={`${data.unread} unread`} actions={<ActionForm inline action={markAllReadAction} submitLabel="Mark all as read" submitVariant="secondary" />} />
      <Tabs basePath="/notifications" active={tab} tabs={[{ key: "inbox", label: "Inbox" }, { key: "preferences", label: "Preferences" }]} />
      {data.items.length === 0 ? <EmptyState title="No notifications" /> : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-white">
          {data.items.map((n) => (
            <li key={n.id} className={`px-4 py-3 text-sm ${!n.readAt ? "bg-navy-50/60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{!n.readAt && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-navy-700" aria-label="Unread" />}{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</span><span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span></div>
              <p className="mt-0.5 whitespace-pre-line text-muted">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pageSize={30} total={data.total} basePath="/notifications" params={sp} />
    </>
  );
}
