import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60";
export const selectClass = `${inputClass} appearance-none pr-8`;
export const textareaClass = `${inputClass} resize-y`;
export const labelClass = "mb-1.5 block eyebrow text-fg-3";

/**
 * Label + control + hint/error, with a real htmlFor: pass the same `id` to
 * the input inside. No cloneElement magic — the caller owns the control.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  className = "",
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  required?: boolean | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-fg-3">{hint}</p>
      ) : null}
    </div>
  );
}
