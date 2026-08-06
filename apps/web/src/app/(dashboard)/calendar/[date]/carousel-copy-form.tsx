import { updateCarouselCopyAction } from "@/lib/actions";
import { inputClass, labelClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

export function CarouselCopyForm({
  tenantId,
  creativeId,
  date,
  slides,
}: {
  tenantId: string;
  creativeId: string;
  date: string;
  slides: string[];
}) {
  return (
    <form action={updateCarouselCopyAction} className="space-y-3 border-t border-ink-700 p-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="creativeId" value={creativeId} />

      <p className={labelClass}>Copy del carrusel</p>
      {slides.map((slide, i) => (
        <div key={i}>
          <label className="mb-1 block text-[11px] text-neutral-600">Slide {i + 1}</label>
          <textarea name="slides" defaultValue={slide} rows={2} className={inputClass} />
        </div>
      ))}

      <SubmitButton
        pendingText="Guardando…"
        className="rounded-lg bg-pulso-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        Guardar copy
      </SubmitButton>
    </form>
  );
}
