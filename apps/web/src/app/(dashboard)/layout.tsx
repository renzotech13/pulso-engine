import type { ReactNode } from "react";
import { getTenantContext } from "@/lib/tenant-context";
import { signOutAction } from "@/lib/actions";
import { TenantSwitcher } from "@/components/tenant-switcher";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getTenantContext();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col justify-between border-r border-neutral-800 p-4">
        <div className="space-y-6">
          <div>
            <p className="text-xs uppercase text-neutral-500">Tenant activo</p>
            <p className="font-medium">{ctx.tenantName}</p>
            <TenantSwitcher memberships={ctx.memberships} activeTenantId={ctx.tenantId} />
          </div>
          <nav className="space-y-1 text-sm">
            <a href="/calendar" className="block rounded px-2 py-1 hover:bg-neutral-900">
              Calendario
            </a>
            <a href="/catalog" className="block rounded px-2 py-1 hover:bg-neutral-900">
              Catálogo
            </a>
            <a href="/agents" className="block rounded px-2 py-1 hover:bg-neutral-900">
              Agent runs
            </a>
            <a href="/events" className="block rounded px-2 py-1 hover:bg-neutral-900">
              Eventos
            </a>
          </nav>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="text-xs text-neutral-500 hover:text-neutral-300">
            Cerrar sesión
          </button>
        </form>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
