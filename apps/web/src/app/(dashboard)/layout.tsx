import type { ReactNode } from "react";
import { BarChart3, CalendarDays, Gauge, Link2, Newspaper, Package, Palette } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { isAdminEmail } from "@/lib/admin";
import { readFlash } from "@/lib/flash";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/ui/dashboard-shell";
import { FlashToast } from "@/components/ui/flash-toast";
import type { NavItem } from "@/components/ui/sidebar-nav";

// The owner's menu: what they act on, in the order they act on it. The
// operator/debug views (agent runs, the event stream) live under /admin now.
const NAV_ITEMS: NavItem[] = [
  { href: "/calendar", label: "Calendario", icon: <CalendarDays size={18} /> },
  { href: "/stats", label: "Estadísticas", icon: <BarChart3 size={18} /> },
  { href: "/news", label: "Noticias", icon: <Newspaper size={18} /> },
  { href: "/catalog", label: "Catálogo", icon: <Package size={18} /> },
  { href: "/brand-kit", label: "Marca", icon: <Palette size={18} /> },
  { href: "/connections", label: "Conexiones", icon: <Link2 size={18} /> },
];

const OPERATOR_NAV_ITEMS: NavItem[] = [
  { href: "/admin/observability", label: "Panel interno", icon: <Gauge size={18} /> },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();
  const [
    {
      data: { user },
    },
    flash,
  ] = await Promise.all([supabase.auth.getUser(), readFlash()]);
  const operator = isAdminEmail(user?.email);

  return (
    <DashboardShell
      productLabel="Pulso Engine"
      tenant={{ name: ctx.tenantName, memberships: ctx.memberships, activeTenantId: ctx.tenantId }}
      navItems={NAV_ITEMS}
      secondaryNavItems={operator ? OPERATOR_NAV_ITEMS : undefined}
      secondaryNavLabel={operator ? "Operador" : undefined}
    >
      {children}
      <FlashToast initial={flash} />
    </DashboardShell>
  );
}
