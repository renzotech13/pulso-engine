"use client";

import { useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { signOutAction } from "@/lib/actions";
import { TenantSwitcher } from "@/components/tenant-switcher";
import type { TenantSummary } from "@/lib/tenant-context";
import { buttonClass } from "./button";
import { SidebarNav, type NavItem } from "./sidebar-nav";

export function DashboardShell({
  productLabel,
  tenant,
  rightLabel,
  navItems,
  secondaryNavItems,
  secondaryNavLabel,
  children,
}: {
  productLabel: string;
  /** Omit for cross-tenant surfaces (e.g. the internal admin panel) that don't act within a single tenant. */
  tenant?: { name: string; memberships: TenantSummary[]; activeTenantId: string } | undefined;
  rightLabel?: string | undefined;
  navItems: NavItem[];
  secondaryNavItems?: NavItem[] | undefined;
  secondaryNavLabel?: string | undefined;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-ink">
      <header className="flex h-[72px] items-center justify-between border-b border-line bg-gradient-to-r from-surface-2 to-ink px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="text-fg-2 transition-colors hover:text-fg lg:hidden"
            aria-label="Abrir menú"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <span className="font-display text-lg tracking-tight text-fg">{productLabel}</span>
        </div>

        <div className="flex items-center gap-4">
          {tenant && (
            <>
              <div className="hidden text-right sm:block">
                <p className="eyebrow text-fg-3">Negocio</p>
                <p className="font-display text-sm text-fg">{tenant.name}</p>
              </div>
              <TenantSwitcher memberships={tenant.memberships} activeTenantId={tenant.activeTenantId} />
            </>
          )}
          {!tenant && rightLabel && (
            <p className="hidden eyebrow text-fg-3 sm:block">{rightLabel}</p>
          )}
          <form action={signOutAction}>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              <LogOut size={14} aria-hidden="true" />
              Salir
            </button>
          </form>
        </div>
      </header>

      <div className="flex">
        <aside
          className={`fixed inset-y-0 left-0 top-[72px] z-20 w-64 border-r border-line bg-gradient-to-b from-surface-2 to-ink p-4 transition-transform duration-300 ease-in-out lg:static lg:top-0 lg:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <SidebarNav
            items={navItems}
            secondaryItems={secondaryNavItems}
            secondaryLabel={secondaryNavLabel}
            onNavigate={() => setMobileOpen(false)}
          />
        </aside>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-10 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
