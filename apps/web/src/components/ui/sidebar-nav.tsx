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

export function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            {...(onNavigate ? { onClick: onNavigate } : {})}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-300 ease-in-out ${
              active
                ? "bg-ink-950 text-pulso-accent"
                : "text-neutral-400 hover:bg-ink-950 hover:text-neutral-100"
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
