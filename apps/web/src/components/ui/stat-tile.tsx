import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./card";

const VALUE_TONE = {
  neutral: "text-neutral-100",
  green: "text-status-green",
  orange: "text-status-orange",
  pink: "text-status-pink",
} as const;

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
  tone?: keyof typeof VALUE_TONE | undefined;
  href?: string | undefined;
}) {
  const body = (
    <Card padding="sm" className={href ? "transition-colors duration-200 hover:border-pulso-accent/60" : ""}>
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 font-display text-3xl ${VALUE_TONE[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
