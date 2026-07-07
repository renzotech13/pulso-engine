import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";

export const ACTIVE_TENANT_COOKIE = "pulso-active-tenant";

export interface TenantSummary {
  tenantId: string;
  tenantName: string;
  role: "owner" | "admin" | "viewer";
}

export interface TenantContext extends TenantSummary {
  memberships: TenantSummary[];
}

/**
 * Resolves the signed-in user's active tenant for this request. RLS already
 * guarantees `memberships`/`tenants` only return rows the user belongs to —
 * this just picks which one is "active" (cookie, falling back to the first).
 * Redirects to /login (no session) or /onboarding (session but zero tenants).
 */
export async function getTenantContext(): Promise<TenantContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: memberships, error: membershipsError } = await supabase
    .from("memberships")
    .select("tenant_id, role");

  if (membershipsError) {
    throw new Error(`failed to load memberships: ${membershipsError.message}`);
  }
  if (!memberships || memberships.length === 0) {
    redirect("/onboarding");
  }

  const tenantIds = memberships.map((m) => m.tenant_id);
  const { data: tenants, error: tenantsError } = await supabase
    .from("tenants")
    .select("id, name")
    .in("id", tenantIds);

  if (tenantsError) {
    throw new Error(`failed to load tenants: ${tenantsError.message}`);
  }

  const summaries: TenantSummary[] = memberships.map((m) => ({
    tenantId: m.tenant_id,
    role: m.role,
    tenantName: tenants?.find((t) => t.id === m.tenant_id)?.name ?? "Untitled",
  }));

  const cookieStore = await cookies();
  const activeTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
  const active = summaries.find((s) => s.tenantId === activeTenantId) ?? summaries[0]!;

  return { ...active, memberships: summaries };
}
