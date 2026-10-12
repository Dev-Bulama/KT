import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requirePageActor } from "@/modules/auth/current";
import { getSiteContent, getSiteContentStatus } from "@/modules/site/content";
import { SECTIONS, type SectionKey } from "@/modules/site/content-schema";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { SiteContentForm } from "@/components/forms/site-content-form";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Website content" };

const PAGES: { key: SectionKey; path?: string }[] = [
  { key: "home", path: "/" },
  { key: "about", path: "/about" },
  { key: "services", path: "/services" },
  { key: "contact", path: "/contact" },
  { key: "privacy", path: "/privacy" },
  { key: "announcement", path: "/" },
];

export default async function WebsiteContent({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageActor("site.content.manage");
  const sp = await searchParams;
  const active = PAGES.find((p) => p.key === sp.tab) ?? PAGES[0];
  const [value, status] = await Promise.all([getSiteContent(active.key), getSiteContentStatus()]);
  const def = SECTIONS[active.key];
  const updated = status.get(active.key);
  return (
    <>
      <PageHeader title="Website content" description="Edit the text of the public website. Changes are published immediately and recorded in the audit log." />
      <Tabs basePath="/admin/site" active={active.key} tabs={PAGES.map((p) => ({ key: p.key, label: SECTIONS[p.key].title }))} />
      <Card>
        <CardHeader
          title={<>{def.title} {updated ? <Badge tone="info">edited {formatDateTime(updated)}</Badge> : <Badge>default text</Badge>}</>}
          description={def.description}
          actions={active.path ? <Link href={active.path} target="_blank" className="inline-flex items-center gap-1 text-sm">View page <ExternalLink className="h-3.5 w-3.5" aria-hidden /></Link> : undefined}
        />
        <CardBody>
          <SiteContentForm key={active.key} section={active.key} value={value as Record<string, unknown>} customised={Boolean(updated)} returnTo={`/admin/site?tab=${active.key}`} />
        </CardBody>
      </Card>
    </>
  );
}
