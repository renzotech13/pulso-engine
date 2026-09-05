"use client";

import { useActionState } from "react";
import { moveCalendarSlotDateAction, type MoveCalendarSlotDateState } from "@/lib/actions";
import { Field, inputClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

const initialState: MoveCalendarSlotDateState = { error: null };

// This action is NOT one of the toast-wrapped void actions: a taken target
// day is an expected outcome, returned via useActionState and shown inline
// next to the date field (see the comment on moveCalendarSlotDateAction).
export function MoveDateForm({ tenantId, slotId, date }: { tenantId: string; slotId: string; date: string }) {
  const [state, formAction] = useActionState(moveCalendarSlotDateAction, initialState);
  const id = `move-date-${slotId}`;

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slotId" value={slotId} />
      <Field id={id} label="Mover al día" error={state.error} className="min-w-[180px]">
        <input id={id} type="date" name="newDate" defaultValue={date} className={inputClass} />
      </Field>
      <SubmitButton variant="secondary" size="md" pendingText="Moviendo…" className="mt-[1.4rem]">
        Mover fecha
      </SubmitButton>
    </form>
  );
}
