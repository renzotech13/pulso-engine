import type { ReactNode } from "react";

const VARIANT_CLASS = {
  primary: "bg-pulso-primaryDim text-neutral-100",
  accent: "bg-pulso-accent text-ink-950",
  blue: "bg-status-blue text-neutral-100",
  pink: "bg-status-pink text-neutral-100",
  orange: "bg-status-orange text-ink-950",
  green: "bg-status-green text-ink-950",
  grey: "bg-status-grey text-ink-950",
} as const;

export type BadgeVariant = keyof typeof VARIANT_CLASS;

export function Badge({
  variant = "primary",
  className = "",
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
