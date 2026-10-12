import { requirePageActor } from "@/modules/auth/current";
import { getLogoMeta, getSiteContent, getSiteContentStatus } from "@/modules/site/content";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { ActionForm } from "@/components/forms/action-form";
import { SiteContentForm } from "@/components/forms/site-content-form";
import { Logo } from "@/components/layout/logo";
import { formatDateTime } from "@/lib/utils";
import { logoRemoveAction, logoUploadAction } from "../site-actions";

export const metadata = { title: "Branding & logo" };

export default async function Branding() {
  await requirePageActor("site.content.manage");
  const [logo, branding, status] = await Promise.all([getLogoMeta(), getSiteContent("branding"), getSiteContentStatus()]);
  const updated = status.get("branding");
  return (
    <>
      <PageHeader title="Branding & logo" description="The logo and name appear in the header of the public website, the sign-in pages and the signed-in workspace." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Logo" description={logo ? `Custom logo uploaded ${formatDateTime(logo.updatedAt)}.` : "The built-in mark is in use."} />
          <CardBody className="space-y-5">
            <div className="grid gap-3">
              <div className="rounded-md border border-line bg-white p-4"><p className="mb-2 text-xs text-muted">On light backgrounds</p><Logo /></div>
              <div className="rounded-md bg-navy-950 p-4"><p className="mb-2 text-xs text-navy-100">In the workspace sidebar</p><Logo light /></div>
            </div>
            <ActionForm action={logoUploadAction} submitLabel="Upload logo" resetOnSuccess>
              <Field label="Logo image" name="logo" hint="PNG, JPEG or WebP, up to 1 MB. A wide logo with a transparent background, about 360 × 72 pixels, works best. SVG is not accepted for security reasons.">
                <Input type="file" accept="image/png,image/jpeg,image/webp" />
              </Field>
            </ActionForm>
            {logo && <ActionForm action={logoRemoveAction} submitLabel="Remove logo" submitVariant="secondary" confirm="Remove the uploaded logo and show the built-in mark?" />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Name, tagline and footer" description={updated ? `Edited ${formatDateTime(updated)}` : "Default text"} />
          <CardBody>
            <SiteContentForm section="branding" value={branding as Record<string, unknown>} customised={Boolean(updated)} returnTo="/admin/branding" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
