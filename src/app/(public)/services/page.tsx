import { listCatalog } from "@/modules/admin/catalog";

export const metadata = { title: "Service catalogue" };
export const dynamic = "force-dynamic";

export default async function Services() {
  const catalog = await listCatalog();
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-2xl font-semibold">ICT service catalogue</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">Services KATDICT offers to Katsina State MDAs. Service-level targets are indicative and are measured from submission, excluding time spent waiting for information from the MDA.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {catalog.map((c) => (
          <section key={c.id} className="rounded-[var(--radius-card)] border border-line bg-white p-5" aria-labelledby={`cat-${c.id}`}>
            <h2 id={`cat-${c.id}`} className="font-semibold">{c.name}</h2>
            {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
            <ul className="mt-3 space-y-3">
              {c.services.map((s) => (
                <li key={s.id} id={s.id} className="border-t border-line pt-3 text-sm">
                  <p className="font-medium">{s.name}</p>
                  {s.standardDeliverables.length > 0 && <p className="mt-1 text-muted">Typical deliverables: {s.standardDeliverables.join(", ")}.</p>}
                  <p className="mt-1 text-xs text-muted">
                    Assessment target: {s.slaAssessmentDays ?? c.slaAssessmentDays} working days · Delivery target: {s.slaDeliveryDays ?? c.slaDeliveryDays} days
                    {s.suggestedDepartment ? ` · ${s.suggestedDepartment.name}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
