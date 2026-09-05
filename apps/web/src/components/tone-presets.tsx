"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClass, textareaClass } from "@/components/ui/field";

const PRESETS = [
  "Cercano y relajado",
  "Profesional y directo",
  "Divertido y juvenil",
  "Elegante y premium",
];

interface TonePresetsProps {
  name: string;
  defaultValue?: string;
  id?: string | undefined;
}

/**
 * Plain textarea + a row of preset chips that fill it in — the "guided"
 * part of tone-of-voice onboarding. Chips just set the textarea's value,
 * nothing fancier; the user can still edit freely after picking one.
 */
export function TonePresets({ name, defaultValue, id }: TonePresetsProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div>
      <textarea
        ref={textareaRef}
        id={id}
        name={name}
        defaultValue={defaultValue}
        rows={3}
        placeholder="¿Cómo le habla tu negocio a sus clientes?"
        className={textareaClass}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (textareaRef.current) textareaRef.current.value = preset;
            }}
          >
            {preset}
          </Button>
        ))}
      </div>
    </div>
  );
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

interface ColorFieldProps {
  /** The form field name — carried by the hex text input only. */
  name: string;
  label: string;
  defaultValue: string;
}

/**
 * Swatch + hex text input + native colour picker, kept in sync. Only the
 * text input carries `name`, so the Server Action still receives a single
 * `#rrggbb` value under the same key as before. The picker is the swatch
 * itself (an invisible <input type="color"> stretched over it).
 */
export function ColorField({ name, label, defaultValue }: ColorFieldProps) {
  const [text, setText] = useState(defaultValue);
  // The native picker only accepts a valid #rrggbb; while the user is
  // mid-typing we keep showing the last valid colour.
  const [valid, setValid] = useState(HEX_RE.test(defaultValue) ? defaultValue : "#000000");
  const id = `color-${name}`;

  function update(next: string) {
    setText(next);
    if (HEX_RE.test(next)) setValid(next);
  }

  return (
    <Field id={id} label={label} hint="Formato #RRGGBB">
      <div className="flex items-center gap-2">
        <span
          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-ink-700 shadow-inner"
          style={{ backgroundColor: valid }}
        >
          <input
            type="color"
            value={valid}
            onChange={(event) => update(event.target.value.toUpperCase())}
            aria-label={`Elegir ${label.toLowerCase()}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
        <input
          id={id}
          name={name}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={7}
          pattern="^#[0-9a-fA-F]{6}$"
          title="Un color en formato #RRGGBB"
          value={text}
          onChange={(event) => update(event.target.value.trim())}
          className={`${inputClass} w-28 font-mono uppercase`}
        />
      </div>
    </Field>
  );
}
