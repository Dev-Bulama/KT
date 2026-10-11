import Link from "next/link";
import { requirePageActor } from "@/modules/auth/current";
import { can } from "@/modules/rbac/authorize";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { DepartmentView, ExecutiveView, MdaView, OfficerView, OperationsView } from "./views";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requirePageActor();
  const views: { key: string; label: string }[] = [];
  if (can(actor, "analytics.executive")) views.push({ key: "executive", label: "Executive" });
  if (can(actor, "analytics.operations")) views.push({ key: "operations", label: "Operations" });
  if (actor.headOfDepartmentIds.length || (can(actor, "analytics.department") && actor.departmentId)) views.push({ key: "department", label: "Department" });
  if (can(actor, "project.read.assigned")) views.push({ key: "officer", label: "My work" });
  if (actor.userType === "MDA_USER") views.push({ key: "mda", label: actor.mdaName ?? "My MDA" });
  if (!views.length && can(actor, "report.read.all")) views.push({ key: "executive", label: "Oversight" });
  const active = views.find((v) => v.key === sp.view)?.key ?? views[0]?.key;
  const range = { from: sp.from ? new Date(sp.from) : undefined, to: sp.to ? new Date(`${sp.to}T23:59:59Z`) : undefined };
  return (
    <>
      <PageHeader
        title={`Welcome, ${actor.name.split(" ")[0]}`}
        description={actor.userType === "MDA_USER" ? "Track your MDA's requests, projects and acceptances." : "Live figures from platform records, limited to what your role can access."}
        actions={can(actor, "request.create") ? <Button asChild><Link href="/requests/new">New service request</Link></Button> : undefined}
      />
      {sp.denied && <Alert tone="warning" className="mb-4">You do not have access to the page you requested.</Alert>}
      {views.length > 1 && <Tabs basePath="/dashboard" active={active ?? ""} tabs={views} />}
      {active === "executive" && (
        <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
          <input type="hidden" name="view" value="executive" />
          <label className="flex flex-col">From<Input type="date" name="from" defaultValue={sp.from} className="w-40" /></label>
          <label className="flex flex-col">To<Input type="date" name="to" defaultValue={sp.to} className="w-40" /></label>
          <Button variant="secondary" size="md" type="submit">Apply period</Button>
          {(sp.from || sp.to) && <Link href="/dashboard?view=executive" className="px-2 py-2">Clear</Link>}
        </form>
      )}
      {active === "executive" && <ExecutiveView actor={actor} range={range} />}
      {active === "operations" && <OperationsView actor={actor} />}
      {active === "department" && <DepartmentView actor={actor} />}
      {active === "officer" && <OfficerView actor={actor} />}
      {active === "mda" && <MdaView actor={actor} />}
      {!active && <Alert tone="info">Your account has no dashboard sections. Use the navigation menu.</Alert>}
    </>
  );
}
