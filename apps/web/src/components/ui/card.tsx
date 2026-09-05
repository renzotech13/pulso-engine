import type { ReactNode } from "react";

const PADDING_CLASS = { md: "p-5", sm: "p-4", none: "" } as const;

export function Card({
  padding = "md",
  className = "",
  children,
}: {
  padding?: keyof typeof PADDING_CLASS | undefined;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`card-surface ${PADDING_CLASS[padding]} ${className}`.trim()}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 border-b border-ink-700 pb-3">
      <div>
        <h3 className="font-display text-base tracking-wide text-neutral-100">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
