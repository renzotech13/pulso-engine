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
  const id = `move-date-${slotId}`;
  const slotId_ = `move-slot-${slotId}`;

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slotId" value={slotId} />
      <Field id={id} label="Mover al día" error={state.error} className="min-w-[170px]">
        <input id={id} type="date" name="newDate" defaultValue={date} className={inputClass} />
      </Field>
      {publishHours.length > 1 && (
        <Field id={slotId_} label="Turno" className="min-w-[150px]">
          <select id={slotId_} name="newSlotIndex" defaultValue="" className={selectClass}>
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
    </form>
  );
}
