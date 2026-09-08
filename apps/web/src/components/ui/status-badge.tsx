import type { ReactNode } from "react";

// Los tokens semánticos de tailwind.config — nada de emerald/amber/red-400
// sueltos que se despeguen de la paleta. Acá el color va SIEMPRE atenuado de
// fondo y pleno como texto: un badge de estado se lee de reojo en una tabla
// y un relleno saturado por fila la vuelve ilegible.
const TONE_CLASS = {
  green: "bg-success/15 text-success",
  orange: "bg-amber/15 text-amber",
  pink: "bg-danger/15 text-danger",
  blue: "bg-info/15 text-info",
  grey: "bg-surface-2 text-fg-2",
  accent: "bg-accent/15 text-accent-ink",
} as const;

const DOT_CLASS = {
  green: "bg-success",
  orange: "bg-amber",
  pink: "bg-danger",
  blue: "bg-info",
  // El punto gris tiene que verse sobre la propia píldora gris.
  grey: "bg-fg-3",
  accent: "bg-accent",
} as const;

export type StatusTone = keyof typeof TONE_CLASS;

export function StatusBadge({
  tone,
  children,
  className = "",
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Just the 8px dot — for dense places like calendar cells. */
export function StatusDot({ tone, title }: { tone: StatusTone; title?: string | undefined }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${DOT_CLASS[tone]}`} title={title} />;
}
