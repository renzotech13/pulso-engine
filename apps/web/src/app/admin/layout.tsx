import type { ReactNode } from "react";
import { ArrowLeft, Gauge, LineChart } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { DashboardShell } from "@/components/ui/dashboard-shell";
import type { NavItem } from "@/components/ui/sidebar-nav";

const NAV_ITEMS: NavItem[] = [
  { href: "/admin/observability", label: "Observabilidad", icon: <LineChart size={18} /> },
  { href: "/admin/limits", label: "Límites por tenant", icon: <Gauge size={18} /> },
  { href: "/agents", label: "Volver al dashboard", icon: <ArrowLeft size={18} /> },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { email } = await requireAdmin();

  return (
    <DashboardShell productLabel="Pulso Engine — Panel interno" rightLabel={email} navItems={NAV_ITEMS}>
      {children}
    </DashboardShell>
  );
}
