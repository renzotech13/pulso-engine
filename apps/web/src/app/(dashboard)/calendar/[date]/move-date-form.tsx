"use client";

import { useActionState } from "react";
import { moveCalendarSlotDateAction, type MoveCalendarSlotDateState } from "@/lib/actions";
import { inputClass, labelClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/submit-button";

const initialState: MoveCalendarSlotDateState = { error: null };

export function MoveDateForm({ tenantId, slotId, date }: { tenantId: string; slotId: string; date: string }) {
  const [state, formAction] = useActionState(moveCalendarSlotDateAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slotId" value={slotId} />
      <div>
        <label className={labelClass}>Mover al día</label>
        <input type="date" name="newDate" defaultValue={date} className={inputClass} />
      </div>
      <SubmitButton
        pendingText="Moviendo…"
        className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-pulso-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Mover fecha
      </SubmitButton>
      {state.error && <p className="w-full text-sm text-status-pink">{state.error}</p>}
    </form>
  );
}
