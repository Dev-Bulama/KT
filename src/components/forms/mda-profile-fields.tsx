import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { humanize } from "@/lib/utils";

const CATEGORIES = ["MINISTRY", "DEPARTMENT", "AGENCY", "COMMISSION", "BOARD", "PARASTATAL", "INSTITUTION", "OTHER"];

export function MdaProfileFields({ m, lockName, ministries }: {
  m: Record<string, unknown>; lockName?: boolean; ministries: { id: string; name: string }[];
}) {
  const v = (k: string) => (m[k] as string | null | undefined) ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Official MDA name" name="name" required hint={lockName ? "Verified directory name — contact KATDICT to change." : undefined}><Input defaultValue={v("name")} readOnly={lockName} /></Field>
      <Field label="Abbreviation" name="abbreviation" required><Input defaultValue={v("abbreviation")} readOnly={lockName} /></Field>
      <Field label="Category" name="category" required><Select defaultValue={v("category") || "MINISTRY"}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></Field>
      <Field label="Supervising ministry" name="supervisingMinistryId"><Select defaultValue={v("supervisingMinistryId")}><option value="">— None —</option>{ministries.filter((x) => x.id !== m.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
      <Field label="Physical address" name="address" required className="sm:col-span-2"><Input defaultValue={v("address")} /></Field>
      <Field label="Official email" name="officialEmail" required><Input type="email" defaultValue={v("officialEmail")} /></Field>
      <Field label="Official telephone" name="officialPhone" required><Input defaultValue={v("officialPhone")} /></Field>
      <Field label="Contact person" name="contactPersonName" required><Input defaultValue={v("contactPersonName")} /></Field>
      <Field label="Contact designation" name="contactPersonDesignation" required><Input defaultValue={v("contactPersonDesignation")} /></Field>
      <Field label="ICT contact" name="ictContactName"><Input defaultValue={v("ictContactName")} /></Field>
      <Field label="ICT contact email" name="ictContactEmail"><Input type="email" defaultValue={v("ictContactEmail")} /></Field>
      <Field label="ICT contact telephone" name="ictContactPhone"><Input defaultValue={v("ictContactPhone")} /></Field>
      <Field label="Website" name="website"><Input type="url" defaultValue={v("website")} /></Field>
      <Field label="Organisational details" name="description" className="sm:col-span-2"><Textarea defaultValue={v("description")} /></Field>
    </div>
  );
}
