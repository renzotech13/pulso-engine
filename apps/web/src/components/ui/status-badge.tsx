import type { ReactNode } from "react";

// Only the status.* tokens from tailwind.config — no more ad-hoc
// emerald/amber/red-400 that drifted from the palette.
const TONE_CLASS = {
  green: "bg-status-green/15 text-status-green",
  orange: "bg-status-orange/15 text-status-orange",
  pink: "bg-status-pink/15 text-status-pink",
  blue: "bg-status-blue/20 text-neutral-100",
  grey: "bg-ink-800 text-neutral-400",
  accent: "bg-pulso-accent/15 text-pulso-accent",
} as const;

const DOT_CLASS = {
  green: "bg-status-green",
  orange: "bg-status-orange",
  pink: "bg-status-pink",
  blue: "bg-status-blue",
  grey: "bg-neutral-600",
  accent: "bg-pulso-accent",
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
