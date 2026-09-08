"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Upload, X } from "lucide-react";
import { regenerateCarouselSlideAction, replaceCarouselSlidePhotoAction } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";
import { Button, buttonClass } from "@/components/ui/button";
import { AutoSubmitFileInput } from "@/components/auto-submit-file-input";

interface CarouselSlideGridProps {
  urls: string[];
  creativeId: string;
  tenantId: string;
  date: string;
  /** Which of the day's publications this is — see `tenants.publish_hours`. */
  slotIndex: number;
}

/**
 * Per-slide fix controls for an AI-generated carousel — separate from
 * ThumbnailGrid (which only ever deletes) because a carousel slide can't
 * just be removed without leaving a gap in the copy; it needs a replacement
 * photo, either AI-regenerated or uploaded by hand.
 *
 * Client-side because of the lightbox: reviewing a carousel means looking at
 * every slide in order, and the thumbnails are far too small to judge whether
 * the text sits right. Opening each one in its own tab (what this used to do)
 * made that a chore.
 */
export function CarouselSlideGrid({
  urls,
  creativeId,
  tenantId,
  date,
  slotIndex,
}: CarouselSlideGridProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) =>
      setOpenIndex((current) =>
        current === null ? null : (current + delta + urls.length) % urls.length,
      ),
    [urls.length],
  );

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, close, step]);

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {urls.map((url, i) => (
          <div
            key={url}
            className="group relative aspect-square overflow-hidden rounded-btn border border-line transition-colors duration-200 hover:border-accent/60"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              title={`Ver slide ${i + 1}`}
              className="block h-full w-full cursor-zoom-in"
            >
              <img src={url} alt={`Slide ${i + 1}`} className="h-full w-full object-cover" />
            </button>
            <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-fg">
              {i + 1}
            </span>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/75 py-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
              <form action={regenerateCarouselSlideAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="slotIndex" value={slotIndex} />
                <input type="hidden" name="creativeId" value={creativeId} />
                <input type="hidden" name="slideIndex" value={i} />
                <SubmitButton
                  variant="subtle"
                  size="sm"
                  title="Regenerar esta imagen con IA"
                  aria-label={`Regenerar slide ${i + 1} con IA`}
                  pendingText={<span className="sr-only">Regenerando…</span>}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                </SubmitButton>
              </form>
              <form action={replaceCarouselSlidePhotoAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="slotIndex" value={slotIndex} />
                <input type="hidden" name="creativeId" value={creativeId} />
                <input type="hidden" name="slideIndex" value={i} />
                <label
                  title="Reemplazar con una foto propia"
                  className={buttonClass("subtle", "sm", "cursor-pointer")}
                >
                  <Upload size={14} aria-hidden="true" />
                  <span className="sr-only">Reemplazar slide {i + 1} con una foto propia</span>
                  <AutoSubmitFileInput name="photo" accept="image/*" className="hidden" />
                </label>
              </form>
            </div>
          </div>
        ))}
      </div>

      {openIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Slide ${openIndex + 1} de ${urls.length}`}
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={close}
            title="Cerrar (Esc)"
            aria-label="Cerrar"
            className="absolute right-4 top-4"
          >
            <X size={16} aria-hidden="true" />
          </Button>

          {urls.length > 1 && (
            <Button
              type="button"
              variant="subtle"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              title="Anterior (←)"
              aria-label="Slide anterior"
              className="absolute left-2 rounded-full sm:left-6"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </Button>
          )}

          {/* Stops the overlay's click-to-close from firing on the image itself. */}
          <figure onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-3">
            <img
              src={urls[openIndex]}
              alt={`Slide ${openIndex + 1}`}
              className="max-h-[80vh] max-w-full rounded-btn object-contain"
            />
            <figcaption className="flex items-center gap-4 text-sm text-fg-2">
              <span>
                Slide {openIndex + 1} de {urls.length}
              </span>
              <a href={urls[openIndex]} target="_blank" rel="noreferrer" className={buttonClass("link")}>
                Abrir original
              </a>
            </figcaption>
          </figure>

          {urls.length > 1 && (
            <Button
              type="button"
              variant="subtle"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              title="Siguiente (→)"
              aria-label="Slide siguiente"
              className="absolute right-2 rounded-full sm:right-6"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </>
  );
}
