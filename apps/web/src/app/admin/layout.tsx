import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-neutral-800 p-4">
        <p className="mb-4 text-xs uppercase text-neutral-500">Panel interno</p>
        <nav className="space-y-1 text-sm">
          <a href="/admin/observability" className="block rounded px-2 py-1 hover:bg-neutral-900">
            Observabilidad
          </a>
          <a href="/admin/limits" className="block rounded px-2 py-1 hover:bg-neutral-900">
            Límites por tenant
          </a>
          <a href="/agents" className="mt-6 block rounded px-2 py-1 text-neutral-500 hover:bg-neutral-900">
            ← Volver al dashboard
          </a>
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
