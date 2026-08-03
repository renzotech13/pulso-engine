"use client";

import { useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { signOutAction } from "@/lib/actions";
import { TenantSwitcher } from "@/components/tenant-switcher";
import type { TenantSummary } from "@/lib/tenant-context";
import { SidebarNav, type NavItem } from "./sidebar-nav";

export function DashboardShell({
  productLabel,
  tenant,
  rightLabel,
  navItems,
  children,
}: {
  productLabel: string;
  /** Omit for cross-tenant surfaces (e.g. the internal admin panel) that don't act within a single tenant. */
  tenant?: { name: string; memberships: TenantSummary[]; activeTenantId: string };
  rightLabel?: string;
  navItems: NavItem[];
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="flex h-[72px] items-center justify-between border-b border-ink-700 bg-gradient-to-r from-ink-800 to-ink-950 px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="text-neutral-400 transition-colors hover:text-neutral-100 lg:hidden"
            aria-label="Abrir menú"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <span className="font-display text-lg tracking-wide text-neutral-100">{productLabel}</span>
        </div>

        <div className="flex items-center gap-4">
          {tenant && (
            <>
              <div className="hidden text-right sm:block">
                <p className="text-[10px] uppercase tracking-wide text-neutral-500">Tenant activo</p>
                <p className="font-display text-sm text-neutral-200">{tenant.name}</p>
              </div>
              <TenantSwitcher memberships={tenant.memberships} activeTenantId={tenant.activeTenantId} />
            </>
          )}
          {!tenant && rightLabel && (
            <p className="hidden text-xs uppercase tracking-wide text-neutral-500 sm:block">{rightLabel}</p>
          )}
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-400 transition-colors duration-300 ease-in-out hover:border-pulso-accent/60 hover:text-neutral-100"
            >
              <LogOut size={14} />
              Salir
            </button>
          </form>
        </div>
      </header>

      <div className="flex">
        <aside
          className={`fixed inset-y-0 left-0 top-[72px] z-20 w-64 border-r border-ink-700 bg-gradient-to-b from-ink-800 to-ink-950 p-4 transition-transform duration-300 ease-in-out lg:static lg:top-0 lg:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <SidebarNav items={navItems} onNavigate={() => setMobileOpen(false)} />
        </aside>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-10 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        <main className="min-w-0 flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
