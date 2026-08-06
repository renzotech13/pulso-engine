import { updateCreativeCaptionAction } from "@/lib/actions";
import { inputClass, labelClass } from "@/components/ui/field";
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
  return (
    <form action={updateCreativeCaptionAction} className="mt-3 space-y-2 border-t border-ink-700 pt-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="creativeId" value={creativeId} />

      <p className={labelClass}>Copy de la publicación</p>
      <textarea name="caption" defaultValue={caption} rows={6} className={inputClass} />

      <SubmitButton
        pendingText="Guardando…"
        className="rounded-lg bg-pulso-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        Guardar copy
      </SubmitButton>
    </form>
  );
}
