"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  /** A rendered icon element (e.g. `<CalendarDays size={18} />`), not a component reference —
   * lucide-react's forwardRef components aren't plain objects, so they can't cross the
   * Server→Client boundary as a bare prop; a rendered element is a plain, serializable React element. */
  icon: ReactNode;
}

export function SidebarNav({
  items,
  secondaryItems,
  secondaryLabel,
  onNavigate,
}: {
  items: NavItem[];
  /** Rendered under a divider — operator-only entries. */
  secondaryItems?: NavItem[] | undefined;
  secondaryLabel?: string | undefined;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        {...(onNavigate ? { onClick: onNavigate } : {})}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
          // A real highlight, not the page background (which read as a hole).
          active ? "bg-pulso-primary/15 text-pulso-accent" : "text-neutral-400 hover:bg-ink-950 hover:text-neutral-100"
        }`}
      >
        {item.icon}
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <nav className="space-y-1">
      {items.map(renderItem)}
      {secondaryItems && secondaryItems.length > 0 && (
        <div className="mt-4 border-t border-ink-700 pt-4">
          {secondaryLabel && (
            <p className="mb-1 px-3 text-[10px] uppercase tracking-[0.2em] text-neutral-600">{secondaryLabel}</p>
          )}
          {secondaryItems.map(renderItem)}
        </div>
      )}
    </nav>
  );
}
