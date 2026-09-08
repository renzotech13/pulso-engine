import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./card";

const VALUE_TONE = {
  neutral: "text-fg",
  green: "text-success",
  orange: "text-amber",
  pink: "text-danger",
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
    <Card padding="sm" className={href ? "transition-colors duration-200 hover:border-accent/60" : ""}>
      <p className="eyebrow text-fg-3">{label}</p>
      <p className={`mt-1 font-display text-3xl ${VALUE_TONE[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-3">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
