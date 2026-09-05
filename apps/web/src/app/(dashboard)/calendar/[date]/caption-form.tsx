import { updateCreativeCaptionAction } from "@/lib/actions";
import { Field, textareaClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

export function CaptionForm({
  tenantId,
  creativeId,
  date,
  caption,
}: {
  tenantId: string;
  creativeId: string;
  date: string;
  caption: string;
}) {
  const id = `caption-${creativeId}`;
  return (
    <form action={updateCreativeCaptionAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="creativeId" value={creativeId} />

      <Field id={id} label="Copy de la publicación" hint="Es el texto que acompaña la pieza en Facebook e Instagram.">
        <textarea id={id} name="caption" defaultValue={caption} rows={6} className={textareaClass} />
      </Field>

      <SubmitButton variant="primary" size="sm" pendingText="Guardando…">
        Guardar copy
      </SubmitButton>
    </form>
  );
}
