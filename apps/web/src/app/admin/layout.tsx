import type { ReactNode } from "react";
import { Activity, ArrowLeft, Gauge, LineChart, ListTree } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { readFlash } from "@/lib/flash";
import { DashboardShell } from "@/components/ui/dashboard-shell";
import { FlashToast } from "@/components/ui/flash-toast";
import type { NavItem } from "@/components/ui/sidebar-nav";

const NAV_ITEMS: NavItem[] = [
  { href: "/admin/observability", label: "Observabilidad", icon: <LineChart size={18} /> },
  { href: "/admin/limits", label: "Límites por tenant", icon: <Gauge size={18} /> },
  { href: "/admin/agents", label: "Corridas de agentes", icon: <Activity size={18} /> },
  { href: "/admin/events", label: "Eventos", icon: <ListTree size={18} /> },
  { href: "/calendar", label: "Volver al dashboard", icon: <ArrowLeft size={18} /> },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [{ email }, flash] = await Promise.all([requireAdmin(), readFlash()]);

  return (
    <DashboardShell productLabel="Pulso Engine — Panel interno" rightLabel={email} navItems={NAV_ITEMS}>
      {children}
      <FlashToast initial={flash} />
    </DashboardShell>
  );
}
