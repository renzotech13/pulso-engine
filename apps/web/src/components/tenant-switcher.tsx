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
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
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
