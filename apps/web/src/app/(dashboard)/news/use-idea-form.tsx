"use client";

import { useActionState } from "react";
import { useNewsSuggestionAction, type UseNewsSuggestionState } from "@/lib/actions";
import { Field, inputClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

const initialState: UseNewsSuggestionState = { error: null };

/**
 * Bound to useActionState because the action returns its error inline (a
 * "day already full" message tied to the date the user picked) instead of
 * flashing a toast — so this form keeps rendering its own error.
 */
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
  const dateId = `news-date-${suggestionId}`;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <Field id={dateId} label="Fecha para el post" error={state.error}>
        <input
          id={dateId}
          type="date"
          name="date"
          required
          defaultValue={defaultDate}
          className={inputClass}
          aria-invalid={state.error ? true : undefined}
        />
      </Field>
      <SubmitButton variant="primary" size="sm" pendingText="Creando…">
        Usar esta idea
      </SubmitButton>
    </form>
  );
}
