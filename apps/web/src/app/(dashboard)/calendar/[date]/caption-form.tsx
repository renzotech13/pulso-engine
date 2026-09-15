import { updateCreativeCaptionAction } from "@/lib/actions";
import { Field, textareaClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

export function CaptionForm({
  tenantId,
  creativeId,
  date,
  caption,
  captionInstagram,
}: {
  tenantId: string;
  creativeId: string;
  date: string;
  caption: string;
  captionInstagram: string;
}) {
  const id = `caption-${creativeId}`;
  const instagramId = `caption-instagram-${creativeId}`;
  return (
    <form action={updateCreativeCaptionAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="creativeId" value={creativeId} />

      <Field id={id} label="Copy para Facebook" hint="El texto completo que acompaña la pieza en Facebook.">
        <textarea id={id} name="caption" defaultValue={caption} rows={6} className={textareaClass} />
      </Field>

      <Field
        id={instagramId}
        label="Copy para Instagram"
        hint="Versión corta con hashtags. Si lo dejas vacío, Instagram usa el mismo texto de Facebook."
      >
        <textarea
          id={instagramId}
          name="captionInstagram"
          defaultValue={captionInstagram}
          rows={4}
          className={textareaClass}
        />
      </Field>

      <SubmitButton variant="primary" size="sm" pendingText="Guardando…">
        Guardar copy
      </SubmitButton>
    </form>
  );
}
