"use client";

import type { FormEvent } from "react";
import { switchTenantAction } from "@/lib/actions";
import type { TenantSummary } from "@/lib/tenant-context";
import { selectClass } from "@/components/ui/field";

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
    <form action={switchTenantAction}>
      <select
        name="tenantId"
        defaultValue={activeTenantId}
        onChange={handleChange}
        aria-label="Cambiar de negocio"
        className={`${selectClass} w-auto py-1.5 text-xs`}
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
