/**
 * Seeds two demo tenants with one owner user each, business categories,
 * PE/global ephemerides, a demo catalog for tenant A (a Lima spa), and the
 * Planner's initial prompt. Idempotent: reruns upsert instead of piling up
 * duplicates.
 */
import { pathToFileURL } from "node:url";
import { createServiceRoleClient } from "./worker.js";

export const SEED_USERS = {
  tenantA: { email: "owner-a@pulso.test", password: "pulso-dev-password-a" },
  tenantB: { email: "owner-b@pulso.test", password: "pulso-dev-password-b" },
} as const;

const BUSINESS_CATEGORIES = [
  { slug: "spa", name: "Spa" },
  { slug: "restaurante", name: "Restaurante" },
  { slug: "optica", name: "Óptica" },
  { slug: "salon_belleza", name: "Salón de belleza" },
  { slug: "barberia", name: "Barbería" },
  { slug: "ecommerce", name: "Ecommerce" },
] as const;

const EPHEMERIDES = [
  {
    name: "Año Nuevo",
    date: "2026-01-01",
    is_recurring_annually: true,
    relevance_tags: ["general"],
    category: "nacional" as const,
  },
  {
    name: "Aniversario de Lima",
    date: "2026-01-18",
    is_recurring_annually: true,
    relevance_tags: ["general"],
    category: "nacional" as const,
  },
  {
    name: "San Valentín",
    date: "2026-02-14",
    is_recurring_annually: true,
    relevance_tags: ["general"],
    category: "comercial" as const,
  },
  {
    name: "Día de la Madre",
    date: "2027-05-09",
    is_recurring_annually: false,
    relevance_tags: ["general"],
    category: "comercial" as const,
  },
  {
    name: "Día del Padre",
    date: "2027-06-20",
    is_recurring_annually: false,
    relevance_tags: ["general"],
    category: "comercial" as const,
  },
  {
    name: "Fiestas Patrias",
    date: "2026-07-28",
    is_recurring_annually: true,
    relevance_tags: ["general"],
    category: "nacional" as const,
  },
  {
    name: "Día Nacional del Café Peruano",
    date: "2026-09-12",
    is_recurring_annually: true,
    relevance_tags: ["restaurante"],
    category: "comercial" as const,
  },
  {
    name: "Santa Rosa de Lima",
    date: "2026-08-30",
    is_recurring_annually: true,
    relevance_tags: ["general"],
    category: "religiosa" as const,
  },
  {
    name: "Black Friday",
    date: "2026-11-27",
    is_recurring_annually: true,
    relevance_tags: ["ecommerce"],
    category: "comercial" as const,
  },
  {
    name: "Navidad",
    date: "2026-12-25",
    is_recurring_annually: true,
    relevance_tags: ["general"],
    category: "comercial" as const,
  },
] as const;

const AGENTS_REGISTRY = [
  { name: "hello", allowed_tools: [], prompt_name: null, model: null },
  { name: "orchestrator", allowed_tools: [], prompt_name: null, model: null },
  { name: "planner", allowed_tools: [], prompt_name: "planner.calendar", model: null },
] as const;

const PLANNER_PROMPT_V1 = `Eres el planificador de contenido de marketing para un negocio local peruano.

Rubro del negocio: {{RUBRO}}

Fechas sin contenido planificado en los próximos 30 días (formato YYYY-MM-DD):
{{OPEN_DATES}}

Efemérides relevantes en este rango (úsalas como inspiración si calzan con alguna fecha libre; no es obligatorio usar todas):
{{EPHEMERIDES}}

Promociones activas del negocio:
{{PROMOTIONS}}

Catálogo de productos/servicios:
{{PRODUCTS}}

Para cada fecha libre que tenga sentido llenar (no es obligatorio llenar todas), propone un tema de contenido.
Responde SOLO con un JSON con esta forma exacta, sin texto adicional ni markdown:
{"slots": [{"date": "YYYY-MM-DD", "slot_type": "post"|"carousel"|"story"|"reel", "theme": "string corto", "rationale": "string breve explicando por qué"}]}`;

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
  rubro: string,
  ownerId: string,
) {
  const { data: existingTenant } = await client
    .from("tenants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  const tenant =
    existingTenant ??
    (await client.from("tenants").insert({ slug, name, rubro }).select("*").single()).data;

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

async function upsertBusinessCategories(client: ReturnType<typeof createServiceRoleClient>) {
  const { error } = await client
    .from("business_categories")
    .upsert([...BUSINESS_CATEGORIES], { onConflict: "slug" });
  if (error) throw new Error(`failed to seed business_categories: ${error.message}`);
}

async function upsertEphemerides(client: ReturnType<typeof createServiceRoleClient>) {
  for (const ephemeris of EPHEMERIDES) {
    const { data: existing } = await client
      .from("ephemerides")
      .select("id")
      .is("tenant_id", null)
      .eq("name", ephemeris.name)
      .eq("date", ephemeris.date)
      .maybeSingle();

    if (existing) continue;

    const { error } = await client.from("ephemerides").insert({
      name: ephemeris.name,
      date: ephemeris.date,
      is_recurring_annually: ephemeris.is_recurring_annually,
      relevance_tags: [...ephemeris.relevance_tags],
      category: ephemeris.category,
      country_code: "PE",
    });
    if (error) throw new Error(`failed to seed ephemeris ${ephemeris.name}: ${error.message}`);
  }
}

async function upsertDemoCatalog(client: ReturnType<typeof createServiceRoleClient>, tenantId: string) {
  const { data: existingProducts } = await client
    .from("products_services")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1);

  if (!existingProducts || existingProducts.length === 0) {
    const { error } = await client.from("products_services").insert([
      { tenant_id: tenantId, name: "Masaje relajante", price: 120, category: "masajes" },
      { tenant_id: tenantId, name: "Masaje descontracturante", price: 130, category: "masajes" },
      { tenant_id: tenantId, name: "Facial hidratante", price: 90, category: "facial" },
      { tenant_id: tenantId, name: "Manicure y pedicure", price: 70, category: "uñas" },
      { tenant_id: tenantId, name: "Depilación láser (sesión)", price: 150, category: "depilación" },
      { tenant_id: tenantId, name: "Día de spa completo (paquete)", price: 350, category: "paquetes" },
    ]);
    if (error) throw new Error(`failed to seed products for tenant ${tenantId}: ${error.message}`);
  }

  const { data: existingPromos } = await client
    .from("promotions")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1);

  if (!existingPromos || existingPromos.length === 0) {
    const { error } = await client.from("promotions").insert([
      {
        tenant_id: tenantId,
        name: "20% en masajes por Fiestas Patrias",
        discount_type: "percentage",
        discount_value: 20,
        starts_at: "2026-07-20T00:00:00Z",
        ends_at: "2026-07-31T23:59:59Z",
        conditions: "Válido de lunes a viernes",
      },
      {
        tenant_id: tenantId,
        name: "15% en facial + manicure",
        discount_type: "percentage",
        discount_value: 15,
        starts_at: "2026-07-01T00:00:00Z",
        ends_at: "2026-08-31T23:59:59Z",
        conditions: "Reservando ambos servicios juntos",
      },
    ]);
    if (error) throw new Error(`failed to seed promotions for tenant ${tenantId}: ${error.message}`);
  }
}

async function upsertPlannerPrompt(client: ReturnType<typeof createServiceRoleClient>) {
  const { data: existing } = await client
    .from("prompts")
    .select("id")
    .eq("name", "planner.calendar")
    .eq("version", 1)
    .maybeSingle();

  if (existing) return;

  const { error } = await client.from("prompts").insert({
    name: "planner.calendar",
    version: 1,
    template: PLANNER_PROMPT_V1,
    is_active: true,
  });
  if (error) throw new Error(`failed to seed planner prompt: ${error.message}`);
}

async function upsertAgentsRegistry(client: ReturnType<typeof createServiceRoleClient>) {
  for (const agent of AGENTS_REGISTRY) {
    const { data: existing } = await client
      .from("agents_registry")
      .select("id")
      .is("tenant_id", null)
      .eq("name", agent.name)
      .maybeSingle();

    if (existing) continue;

    const { error } = await client.from("agents_registry").insert({
      name: agent.name,
      allowed_tools: [...agent.allowed_tools],
      prompt_name: agent.prompt_name,
      model: agent.model,
    });
    if (error) {
      throw new Error(`failed to seed agents_registry entry ${agent.name}: ${error.message}`);
    }
  }
}

async function main() {
  const client = createServiceRoleClient();

  await upsertBusinessCategories(client);
  await upsertEphemerides(client);
  await upsertPlannerPrompt(client);
  await upsertAgentsRegistry(client);

  const userA = await upsertUser(client, SEED_USERS.tenantA.email, SEED_USERS.tenantA.password);
  const userB = await upsertUser(client, SEED_USERS.tenantB.email, SEED_USERS.tenantB.password);

  const tenantA = await upsertTenant(client, "spa-demo-a", "Spa Demo A", "spa", userA.id);
  const tenantB = await upsertTenant(client, "spa-demo-b", "Spa Demo B", "spa", userB.id);

  await upsertDemoCatalog(client, tenantA.id);

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
