"use client";

import { useActionState } from "react";
import { useNewsSuggestionAction, type UseNewsSuggestionState } from "@/lib/actions";
import { inputClass, labelClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

const initialState: UseNewsSuggestionState = { error: null };

export function UseIdeaForm({
  tenantId,
  suggestionId,
  defaultDate,
}: {
  tenantId: string;
  suggestionId: string;
  defaultDate: string;
}) {
  const [state, formAction] = useActionState(useNewsSuggestionAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <div>
        <label className={labelClass}>Fecha para el post</label>
        <input type="date" name="date" defaultValue={defaultDate} className={inputClass} />
      </div>
      <SubmitButton
        pendingText="Creando…"
        className="rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        Usar esta idea
      </SubmitButton>
      {state.error && <p className="w-full text-sm text-status-pink">{state.error}</p>}
    </form>
  );
}
