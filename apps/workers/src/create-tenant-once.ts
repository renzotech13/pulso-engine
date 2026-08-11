import { createServiceRoleClient } from "@pulso/db/worker";

/**
 * Onboards a new client from the CLI.
 *
 * The dashboard can't do this today: /onboarding is the only page that calls
 * create_tenant_with_owner, and it redirects to /agents as soon as you belong
 * to any tenant — so the very first client locks the door behind them. The
 * RPC itself needs auth.uid(), which a script doesn't have, so this writes
 * tenants + memberships directly with the service role instead (same shape as
 * seed.ts's upsertTenant).
 *
 * The owner is whoever already owns `--owner-from`, so the new tenant shows up
 * in that person's tenant switcher.
 *
 * usage: tsx src/create-tenant-once.ts <name> <slug> <rubroSlug> <ownerFromSlug>
 */
const [name, slug, rubro, ownerFromSlug] = process.argv.slice(2);
if (!name || !slug || !rubro || !ownerFromSlug) {
  console.error(
    "usage: tsx src/create-tenant-once.ts <name> <slug> <rubroSlug> <ownerFromTenantSlug>",
  );
  process.exit(1);
}

const service = createServiceRoleClient();

const { data: category } = await service
  .from("business_categories")
  .select("slug, name")
  .eq("slug", rubro)
  .maybeSingle();
if (!category) {
  const { data: all } = await service.from("business_categories").select("slug").order("slug");
  throw new Error(
    `rubro "${rubro}" no existe. Disponibles: ${(all ?? []).map((c) => c.slug).join(", ")}`,
  );
}

const { data: existing } = await service
  .from("tenants")
  .select("id, name")
  .eq("slug", slug)
  .maybeSingle();
if (existing) throw new Error(`el slug "${slug}" ya lo usa "${existing.name}" (${existing.id})`);

const { data: ownerSource } = await service
  .from("tenants")
  .select("id")
  .eq("slug", ownerFromSlug)
  .maybeSingle();
if (!ownerSource) throw new Error(`no existe un tenant con slug "${ownerFromSlug}"`);

const { data: ownerMembership } = await service
  .from("memberships")
  .select("user_id")
  .eq("tenant_id", ownerSource.id)
  .eq("role", "owner")
  .maybeSingle();
if (!ownerMembership) throw new Error(`"${ownerFromSlug}" no tiene un owner del que copiar`);

const { data: tenant, error: tenantError } = await service
  .from("tenants")
  .insert({ name, slug, rubro })
  .select()
  .single();
if (tenantError) throw new Error(`no se pudo crear el tenant: ${tenantError.message}`);

const { error: membershipError } = await service
  .from("memberships")
  .insert({ tenant_id: tenant.id, user_id: ownerMembership.user_id, role: "owner" });
if (membershipError) {
  throw new Error(`tenant creado (${tenant.id}) pero falló el membership: ${membershipError.message}`);
}

console.log(
  JSON.stringify(
    {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      rubro: `${tenant.rubro} (${category.name})`,
      hitl_mode: tenant.hitl_mode,
      status: tenant.status,
    },
    null,
    2,
  ),
);
process.exit(0);
