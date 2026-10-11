import Link from "next/link";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { listClaimableMdas } from "@/modules/mdas/service";
import { registerAction } from "../../(auth)/actions";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Register your MDA" };
export const dynamic = "force-dynamic";

const CATEGORIES = ["MINISTRY", "DEPARTMENT", "AGENCY", "COMMISSION", "BOARD", "PARASTATAL", "INSTITUTION", "OTHER"];

export default async function Register() {
  const claimable = await listClaimableMdas();
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Register your MDA</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Registration must be completed by an authorised representative using an official email address. After you verify your email, KATDICT reviews the institutional profile before the account is activated. Entering an MDA&apos;s name does not grant access to its records.
      </p>
      <ActionForm action={registerAction} submitLabel="Submit registration" className="mt-8">
        <>
            <fieldset className="rounded-[var(--radius-card)] border border-line bg-white p-5">
              <legend className="px-1 text-sm font-semibold">1. Authorised representative</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" name="repName" required><Input autoComplete="name" /></Field>
                <Field label="Designation" name="repDesignation" required><Input /></Field>
                <Field label="Official email" name="repEmail" required><Input type="email" autoComplete="email" /></Field>
                <Field label="Telephone" name="repPhone" required><Input type="tel" autoComplete="tel" /></Field>
                <Field label="Password" name="password" required hint="At least 12 characters with upper-case, lower-case letters and a number."><Input type="password" autoComplete="new-password" /></Field>
                <Field label="Confirm password" name="confirmPassword" required><Input type="password" autoComplete="new-password" /></Field>
              </div>
            </fieldset>
            <fieldset className="rounded-[var(--radius-card)] border border-line bg-white p-5">
              <legend className="px-1 text-sm font-semibold">2. Institution</legend>
              {claimable.length > 0 && (
                <Field label="Is your MDA in the verified directory?" name="claimMdaId" hint="Select it to claim the verified entry (KATDICT will still verify your authority). Leave blank to register a new MDA profile." className="mb-4">
                  <Select defaultValue="">
                    <option value="">— Not listed / new registration —</option>
                    {claimable.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.abbreviation})</option>)}
                  </Select>
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Official MDA name" name="name" required><Input /></Field>
                <Field label="Abbreviation" name="abbreviation" required><Input /></Field>
                <Field label="Category" name="category" required>
                  <Select defaultValue="MINISTRY">{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select>
                </Field>
                <Field label="Official website" name="website"><Input type="url" placeholder="https://" /></Field>
                <Field label="Physical address" name="address" required className="sm:col-span-2"><Input /></Field>
                <Field label="Official email" name="officialEmail" required><Input type="email" /></Field>
                <Field label="Official telephone" name="officialPhone" required><Input type="tel" /></Field>
                <Field label="Contact person" name="contactPersonName" required><Input /></Field>
                <Field label="Contact person's designation" name="contactPersonDesignation" required><Input /></Field>
                <Field label="ICT contact person" name="ictContactName"><Input /></Field>
                <Field label="ICT contact email" name="ictContactEmail"><Input type="email" /></Field>
                <Field label="ICT contact telephone" name="ictContactPhone"><Input type="tel" /></Field>
                <Field label="Organisational details" name="description" className="sm:col-span-2" hint="Mandate, departments, number of staff, locations."><Textarea /></Field>
              </div>
            </fieldset>
          </>
      </ActionForm>
      <p className="mt-6 text-sm text-muted">Already registered? <Link href="/login">Sign in</Link>. Staff of a registered MDA should ask their MDA administrator for an invitation.</p>
    </div>
  );
}
