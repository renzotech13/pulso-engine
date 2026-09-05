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
    <div className="rounded-xl border border-dashed border-ink-700 px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex justify-center text-neutral-600">{icon}</div>}
      <p className="text-sm font-medium text-neutral-200">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
