import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-pulso-accent focus:outline-none";
export const labelClass = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500";

export function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}
