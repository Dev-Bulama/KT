import { requirePageActor } from "@/modules/auth/current";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { MDA_CSV_COLUMNS } from "@/modules/mdas/schemas";
import { importPreviewAction } from "../actions";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import MDA directory" };

export default async function ImportPage() {
  await requirePageActor("mda.import");
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "MDA directory", href: "/mdas" }, { label: "Import" }]} title="Import the verified MDA directory" description="Upload the official, verified list of MDAs. Every row is validated (required fields, values, duplicates within the file and against existing records) before anything is written. The import is all-or-nothing and audited." />
      <Alert tone="warning" className="mb-4">Only import a directory verified by the appropriate State authority. The platform deliberately ships with no official MDA names.</Alert>
      <Card><CardBody className="space-y-4">
        <p className="text-sm">Columns (header row required): <code className="text-xs">{MDA_CSV_COLUMNS.join(", ")}</code>. Required: name, abbreviation, category (MINISTRY, DEPARTMENT, AGENCY, COMMISSION, BOARD, PARASTATAL, INSTITUTION, OTHER). A template is in <code className="text-xs">docs/samples/mda-directory-TEMPLATE.csv</code>.</p>
        <ImportForm action={importPreviewAction} />
      </CardBody></Card>
    </>
  );
}
