import type { ReactNode } from "react";

// Texto oscuro sobre todo relleno de color: el crema no pasa AA sobre
// ninguno de estos tonos (ver el comentario de button.tsx). `primary` es
// atenuado a propósito, para que un badge no compita con un botón naranja.
const VARIANT_CLASS = {
  primary: "bg-accent/15 text-accent-ink",
  accent: "bg-accent text-accent-fg",
  blue: "bg-info text-accent-fg",
  pink: "bg-danger text-accent-fg",
  orange: "bg-amber text-accent-fg",
  green: "bg-success text-accent-fg",
  grey: "bg-surface-2 text-fg-2",
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
