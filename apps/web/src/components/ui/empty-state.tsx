import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex justify-center text-fg-3">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-fg-3">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
