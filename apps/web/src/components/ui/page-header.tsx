import type { ReactNode } from "react";

/**
 * One header for every page: eyebrow = the business name, title = the nav
 * label. Before this, four pages used the tenant name as the h1 and two used
 * "Agent runs — tenant", so nothing said which page you were on.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">{eyebrow}</p>
        <h1 className="font-display text-2xl font-medium">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
