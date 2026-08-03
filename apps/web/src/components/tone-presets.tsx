"use client";

import { useRef } from "react";

const PRESETS = [
  "Cercano y relajado",
  "Profesional y directo",
  "Divertido y juvenil",
  "Elegante y premium",
];

interface TonePresetsProps {
  name: string;
  defaultValue?: string;
}

/**
 * Plain textarea + a row of preset chips that fill it in — the "guided"
 * part of tone-of-voice onboarding. Chips just set the textarea's value,
 * nothing fancier; the user can still edit freely after picking one.
 */
export function TonePresets({ name, defaultValue }: TonePresetsProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div>
      <textarea
        ref={textareaRef}
        name={name}
        defaultValue={defaultValue}
        rows={3}
        placeholder="¿Cómo le habla tu negocio a sus clientes?"
        className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-pulso-accent focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              if (textareaRef.current) textareaRef.current.value = preset;
            }}
            className="rounded-full border border-ink-700 px-3 py-1 text-xs text-neutral-400 transition-colors duration-300 ease-in-out hover:border-pulso-accent/60 hover:text-neutral-100"
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
