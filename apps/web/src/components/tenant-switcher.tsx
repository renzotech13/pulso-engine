"use client";

import type { FormEvent } from "react";
import { switchTenantAction } from "@/lib/actions";
import type { TenantSummary } from "@/lib/tenant-context";

export function TenantSwitcher({
  memberships,
  activeTenantId,
}: {
  memberships: TenantSummary[];
  activeTenantId: string;
}) {
  if (memberships.length <= 1) return null;

  function handleChange(event: FormEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form action={switchTenantAction} className="mt-2">
      <select
        name="tenantId"
        defaultValue={activeTenantId}
        onChange={handleChange}
        className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-neutral-200 focus:border-pulso-accent focus:outline-none"
      >
        {memberships.map((m) => (
          <option key={m.tenantId} value={m.tenantId}>
            {m.tenantName}
          </option>
        ))}
      </select>
    </form>
  );
}
