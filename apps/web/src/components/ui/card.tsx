import type { ReactNode } from "react";

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`card-surface ${className}`}>{children}</div>;
}

export function CardHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between border-b border-ink-700 pb-3">
      <h3 className="font-sans text-sm font-bold text-neutral-100">{title}</h3>
      {actions}
    </div>
  );
}
