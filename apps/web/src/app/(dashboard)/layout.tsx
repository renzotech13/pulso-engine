import type { ReactNode } from "react";
import { Activity, CalendarDays, Link2, ListTree, Newspaper, Package, Palette } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { DashboardShell } from "@/components/ui/dashboard-shell";
import type { NavItem } from "@/components/ui/sidebar-nav";

const NAV_ITEMS: NavItem[] = [
  { href: "/calendar", label: "Calendario", icon: <CalendarDays size={18} /> },
  { href: "/catalog", label: "Catálogo", icon: <Package size={18} /> },
  { href: "/news", label: "Noticias", icon: <Newspaper size={18} /> },
  { href: "/brand-kit", label: "Marca", icon: <Palette size={18} /> },
  { href: "/connections", label: "Conexiones", icon: <Link2 size={18} /> },
  { href: "/agents", label: "Agent runs", icon: <Activity size={18} /> },
  { href: "/events", label: "Eventos", icon: <ListTree size={18} /> },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getTenantContext();

  return (
    <DashboardShell
      productLabel="Pulso Engine"
      tenant={{ name: ctx.tenantName, memberships: ctx.memberships, activeTenantId: ctx.tenantId }}
      navItems={NAV_ITEMS}
    >
      {children}
    </DashboardShell>
  );
}
