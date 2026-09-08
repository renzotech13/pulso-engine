"use client";

import { useActionState } from "react";
import { moveCalendarSlotDateAction, type MoveCalendarSlotDateState } from "@/lib/actions";
import { Field, inputClass, selectClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

const initialState: MoveCalendarSlotDateState = { error: null };

// This action is NOT one of the toast-wrapped void actions: a taken target
// turn is an expected outcome, returned via useActionState and shown inline
// next to the date field (see the comment on moveCalendarSlotDateAction).
export function MoveDateForm({
  tenantId,
  slotId,
  date,
  publishHours,
}: {
  tenantId: string;
  slotId: string;
  date: string;
  /** The tenant's daily turns, e.g. [9, 18]. Empty when it publishes once a day. */
  publishHours: number[];
}) {
  const [state, formAction] = useActionState(moveCalendarSlotDateAction, initialState);
  const dateFieldId = `move-date-${slotId}`;
  const turnFieldId = `move-turn-${slotId}`;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slotId" value={slotId} />

      <div className="flex flex-wrap items-start gap-3">
        <Field id={dateFieldId} label="Mover al día" error={state.error} className="min-w-[170px]">
          <input
            id={dateFieldId}
            type="date"
            name="newDate"
            defaultValue={state.swapWith?.date ?? date}
            className={inputClass}
          />
        </Field>
        {publishHours.length > 1 && (
          <Field id={turnFieldId} label="Turno" className="min-w-[150px]">
            <select
              id={turnFieldId}
              name="newSlotIndex"
              defaultValue={state.swapWith ? String(state.swapWith.slotIndex) : ""}
              className={selectClass}
            >
              <option value="">El que esté libre</option>
              {publishHours.map((hour, index) => (
                <option key={hour} value={index}>
                  {hour}:00
                </option>
              ))}
            </select>
          </Field>
        )}
        <SubmitButton variant="secondary" size="md" pendingText="Moviendo…" className="mt-[1.4rem]">
          Mover
        </SubmitButton>
      </div>

      {/* Offered instead of a dead end when the target turn is taken by a
          piece that hasn't gone out yet: the two trade places. */}
      {state.swapWith && (
        <div className="rounded-btn border border-line bg-ink p-3">
          <p className="text-xs text-fg-2">
            Puedes intercambiarlas: <span className="text-fg">{state.swapWith.theme}</span> pasa a este
            día y turno, y esta pieza toma su lugar.
          </p>
          <SubmitButton
            name="swap"
            value="1"
            variant="primary"
            size="sm"
            pendingText="Intercambiando…"
            className="mt-2"
          >
            Intercambiar las dos
          </SubmitButton>
        </div>
      )}
    </form>
  );
}
