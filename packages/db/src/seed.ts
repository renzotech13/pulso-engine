/**
 * Seeds two demo tenants with one owner user each, for local dev and for the
 * RLS isolation suite (tests/rls.test.ts) to log in as. Idempotent: reruns
 * upsert the same fixed emails/slugs instead of piling up duplicates.
 */
import { pathToFileURL } from "node:url";
import { createServiceRoleClient } from "./worker.js";

export const SEED_USERS = {
  tenantA: { email: "owner-a@pulso.test", password: "pulso-dev-password-a" },
  tenantB: { email: "owner-b@pulso.test", password: "pulso-dev-password-b" },
} as const;

async function upsertUser(
  client: ReturnType<typeof createServiceRoleClient>,
  email: string,
  password: string,
) {
  const { data: existing } = await client.auth.admin.listUsers();
  const found = existing.users.find((user) => user.email === email);
  if (found) return found;

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`failed to create seed user ${email}: ${error?.message}`);
  }
  return data.user;
}

async function upsertTenant(
  client: ReturnType<typeof createServiceRoleClient>,
  slug: string,
  name: string,
  ownerId: string,
) {
  const { data: existingTenant } = await client
    .from("tenants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  const tenant =
    existingTenant ??
    (await client.from("tenants").insert({ slug, name }).select("*").single()).data;

  if (!tenant) throw new Error(`failed to upsert tenant ${slug}`);

  const { data: existingMembership } = await client
    .from("memberships")
    .select("*")
    .eq("tenant_id", tenant.id)
    .eq("user_id", ownerId)
    .maybeSingle();

  if (!existingMembership) {
    const { error } = await client
      .from("memberships")
      .insert({ tenant_id: tenant.id, user_id: ownerId, role: "owner" });
    if (error) throw new Error(`failed to link owner to tenant ${slug}: ${error.message}`);
  }

  return tenant;
}

async function main() {
  const client = createServiceRoleClient();

  const userA = await upsertUser(client, SEED_USERS.tenantA.email, SEED_USERS.tenantA.password);
  const userB = await upsertUser(client, SEED_USERS.tenantB.email, SEED_USERS.tenantB.password);

  const tenantA = await upsertTenant(client, "spa-demo-a", "Spa Demo A", userA.id);
  const tenantB = await upsertTenant(client, "spa-demo-b", "Spa Demo B", userB.id);

  console.log("Seeded tenants:");
  console.log(`  A: ${tenantA.slug} (${tenantA.id}) — owner ${SEED_USERS.tenantA.email}`);
  console.log(`  B: ${tenantB.slug} (${tenantB.id}) — owner ${SEED_USERS.tenantB.email}`);
}

// Only run when executed directly (`tsx src/seed.ts`), not when imported —
// tests import SEED_USERS from this module and must not re-trigger seeding.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
