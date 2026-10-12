import { ActionForm } from "@/components/forms/action-form";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { FEATURE_ICONS, SECTIONS, type FieldDef, type SectionKey } from "@/modules/site/content-schema";
import { resetSiteContentAction, siteContentAction } from "@/app/(app)/admin/site-actions";

const MARKDOWN_HINT = "Formatting: a blank line starts a new paragraph · ## Heading · - bullet item · 1. numbered item · **bold** · *italic* · [link text](/contact or https://…). HTML is not allowed.";

/** Editor for one CMS section, generated from its field definitions. */
export function SiteContentForm({ section, value, customised, returnTo }: { section: SectionKey; value: Record<string, unknown>; customised: boolean; returnTo: string }) {
  const def = SECTIONS[section];
  return (
    <div className="space-y-4">
      <ActionForm action={siteContentAction} submitLabel="Publish changes">
        <input type="hidden" name="section" value={section} />
        {(def.fields as readonly FieldDef[]).map((f) => {
          const v = value[f.name];
          switch (f.kind) {
            case "boolean":
              return <div key={f.name}><Checkbox id={f.name} name={f.name} label={f.label} defaultChecked={Boolean(v)} /></div>;
            case "select":
              return (
                <Field key={f.name} label={f.label} name={f.name} hint={f.hint}>
                  <Select defaultValue={String(v ?? "")}>{(f.options ?? []).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                </Field>
              );
            case "textarea":
              return <Field key={f.name} label={f.label} name={f.name} hint={f.hint}><Textarea defaultValue={String(v ?? "")} rows={3} /></Field>;
            case "markdown":
              return <Field key={f.name} label={f.label} name={f.name} hint={f.hint ?? MARKDOWN_HINT}><Textarea defaultValue={String(v ?? "")} rows={f.name === "body" ? 16 : 5} className="font-mono text-sm" /></Field>;
            case "lines":
              return <Field key={f.name} label={f.label} name={f.name} hint={f.hint}><Textarea defaultValue={((v as string[]) ?? []).join("\n")} rows={6} /></Field>;
            case "features": {
              const items = (v as { icon: string; title: string; text: string }[]) ?? [];
              return (
                <fieldset key={f.name} className="space-y-3">
                  <legend className="text-sm font-medium">{f.label}</legend>
                  {f.hint && <p className="text-xs text-muted">{f.hint}</p>}
                  {Array.from({ length: 9 }, (_, i) => {
                    const it = items[i];
                    return (
                      <div key={i} className="grid gap-2 rounded-md border border-line p-3 md:grid-cols-[160px_1fr_2fr]">
                        <Field label={`Card ${i + 1} icon`} name={`${f.name}.${i}.icon`}>
                          <Select defaultValue={it?.icon ?? FEATURE_ICONS[0]}>{FEATURE_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}</Select>
                        </Field>
                        <Field label="Title" name={`${f.name}.${i}.title`}><Input defaultValue={it?.title ?? ""} /></Field>
                        <Field label="Text" name={`${f.name}.${i}.text`}><Input defaultValue={it?.text ?? ""} /></Field>
                      </div>
                    );
                  })}
                </fieldset>
              );
            }
            default:
              return <Field key={f.name} label={f.label} name={f.name} hint={f.hint}><Input defaultValue={String(v ?? "")} /></Field>;
          }
        })}
      </ActionForm>
      {customised && (
        <ActionForm action={resetSiteContentAction} submitLabel="Restore default content" submitVariant="ghost" successRedirect={returnTo} confirm="Discard the edited content for this section and restore the default text?">
          <input type="hidden" name="section" value={section} />
        </ActionForm>
      )}
    </div>
  );
}
