"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { dismissFlashAction } from "@/lib/actions";
import type { Flash } from "@/lib/flash";

const TONE_CLASS = {
  success: "border-status-green/40 text-status-green",
  error: "border-status-pink/40 text-status-pink",
  info: "border-pulso-accent/40 text-pulso-accent",
} as const;

const AUTO_DISMISS_MS = 5000;

/**
 * Shows the one-shot message an action left in the flash cookie. Always
 * mounted (even with nothing to show) so its local state survives the
 * re-render that follows deleting the cookie — otherwise the toast would
 * vanish the instant it appeared.
 */
export function FlashToast({ initial }: { initial: Flash | null }) {
  const [flash, setFlash] = useState<Flash | null>(initial);

  useEffect(() => {
    if (!initial) return;
    setFlash(initial);
    // Consumed: a refresh must not show it again.
    void dismissFlashAction();
    const timer = setTimeout(() => setFlash(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [initial]);

  if (!flash) return null;
  const Icon = flash.tone === "success" ? CheckCircle2 : flash.tone === "error" ? XCircle : Info;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-xl border bg-ink-900 px-4 py-3 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.4)] ${TONE_CLASS[flash.tone]}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-neutral-100">{flash.message}</p>
      <button
        type="button"
        onClick={() => setFlash(null)}
        aria-label="Cerrar"
        className="ml-1 text-neutral-500 hover:text-neutral-200"
      >
        <X size={14} />
      </button>
    </div>
  );
}
