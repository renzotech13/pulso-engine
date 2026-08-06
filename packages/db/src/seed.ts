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
    accentColorPrimary: "#D91023",
    accentColorSecondary: "#FFFFFF",
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
  { name: "creative", allowed_tools: [], prompt_name: "creative.brief", model: null },
  { name: "news", allowed_tools: [], prompt_name: "news.relevance", model: null },
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

const CREATIVE_PROMPT_V1 = `Eres el redactor de piezas de marketing para un negocio local peruano.

Tipo de pieza: {{SLOT_TYPE}}
Tema aprobado para esta pieza: {{THEME}}

Promociones activas del negocio:
{{PROMOTIONS}}

Catálogo de productos/servicios:
{{PRODUCTS}}

{{INSTRUCTION}}
{{NEWS_CONTEXT}}
{{BRAND_TRAINING}}

Escribe DOS cosas distintas para esta pieza:
1. El texto que va IMPRESO en la imagen (headline/subheadline/priceLabel) — corto, es lo primero que se ve.
2. El campo "caption": el texto real que acompaña la publicación en Facebook/Instagram, debajo de la imagen (nunca va impreso en la imagen). Este SÍ puede ser más largo: 1 a 3 párrafos breves que expliquen la idea, cierra con 3 a 5 hashtags relevantes en español. Si hay una fuente o dato externo real de por medio (una noticia, una cifra citada), menciónala ahí, nunca en el headline.
Sé concreto y usa precios/promociones reales del catálogo cuando calce con el tema.
Reglas de estilo, siempre, para AMBOS campos:
- El headline es un gancho corto (máximo 8-10 palabras) que engancha, no una descripción. Nunca escribas la palabra "carrusel", "post", "publicación" ni nombres del formato — el lector no necesita saber qué tipo de pieza está viendo.
- Nunca uses la raya "—" (em dash) en ningún texto — separa ideas con punto seguido o coma. Es la marca más obvia de que un texto lo escribió una IA.
- Escribe como una persona real le hablaría a otra, no como un anuncio genérico.
Si hay una instrucción adicional del cliente arriba, respétala por encima de tu propio criterio de estilo.
Si el tema se refiere claramente a un producto específico del catálogo de arriba, incluye su nombre EXACTO tal como aparece ahí en el campo "productName" (así se puede usar su foto real en la pieza). Si no aplica a ningún producto puntual, omite ese campo.
Responde SOLO con un JSON con esta forma exacta, sin texto adicional ni markdown:
{"headline": "string corto y llamativo", "subheadline": "string breve opcional", "priceLabel": "string tipo 'Desde S/ 96', opcional", "productName": "nombre exacto del producto del catálogo, opcional", "caption": "string, el texto real de la publicación, 1 a 3 párrafos más hashtags"}`;

const CREATIVE_CAROUSEL_PROMPT_V1 = `Eres el redactor de un carrusel de Instagram/Facebook para un negocio local peruano. Los carruseles con este formato convierten mejor que los reels en el algoritmo actual, especialmente cuando invitan a comentar.

Tema aprobado para esta pieza: {{THEME}}

Promociones activas del negocio:
{{PROMOTIONS}}

Catálogo de productos/servicios:
{{PRODUCTS}}

{{INSTRUCTION}}
{{BRAND_TRAINING}}

Escribe DOS cosas distintas:
1. Entre 5 y 7 slides (frases cortas, una idea por slide, van IMPRESAS en cada imagen) con esta estructura exacta:
   a. Primer slide: un gancho corto (máximo 8-10 palabras) o pregunta llamativa relacionada al tema, que dé ganas de seguir deslizando. Nunca escribas la palabra "carrusel", "post" ni nombres del formato.
   b. Slides del medio (3 a 5): un tip, dato o idea concreta cada uno, cortos, una sola frase, fáciles de leer de un vistazo.
   c. Último slide: SIEMPRE una pregunta directa invitando explícitamente a comentar (ej. "¿Cuál de estos usas tú? Cuéntanos 👇").
2. El campo "caption": el texto real que acompaña la publicación en Facebook/Instagram, debajo de las imágenes (nunca va impreso en ninguna imagen). 1 a 3 párrafos breves resumiendo de qué trata el carrusel y por qué le sirve al lector, cierra con 3 a 5 hashtags relevantes en español. Si hay una fuente o dato externo real de por medio, menciónala ahí.
Reglas de estilo, siempre, para AMBOS campos: nunca uses la raya "—" (em dash), separa ideas con punto seguido o coma en su lugar (es la marca más obvia de que un texto lo escribió una IA); escribe como una persona real le hablaría a otra, no como un anuncio genérico.
Si hay una instrucción adicional del cliente arriba, respétala por encima de tu propio criterio de estilo.
Responde SOLO con un JSON con esta forma exacta, sin texto adicional ni markdown:
{"slides": ["string corto", "string corto", "..."], "caption": "string, el texto real de la publicación, 1 a 3 párrafos más hashtags"}`;

const NEWS_PROMPT_V1 = `Eres el agente de noticias de Pulso Engine. Tu trabajo es revisar los titulares del día y decidir cuáles le sirven a este negocio para crear contenido en redes sociales.

Rubro del negocio: {{RUBRO}}

Titulares de hoy:
{{HEADLINES}}

Para cada titular que sea genuinamente relevante y aprovechable para este negocio, indica su número y un ángulo de contenido concreto: una idea específica de cómo este negocio podría usar esa noticia en una publicación (no una relación forzada ni genérica). Es mejor devolver pocos titulares o ninguno que inventar relevancia donde no la hay.

Responde SOLO con un JSON con esta forma exacta, sin texto adicional ni markdown:
{"relevant": [{"index": 1, "angle": "string breve y concreto"}]}

Si ningún titular es relevante, responde {"relevant": []}.`;

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
      accent_color_primary: "accentColorPrimary" in ephemeris ? ephemeris.accentColorPrimary : null,
      accent_color_secondary: "accentColorSecondary" in ephemeris ? ephemeris.accentColorSecondary : null,
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

const RENDER_TEMPLATES = [
  { name: "social-post", type: "static", engine: "html", component_ref: "social-post" },
  { name: "reel", type: "video", engine: "remotion", component_ref: "reel" },
  { name: "story-promo", type: "video", engine: "remotion", component_ref: "story-promo" },
  { name: "carousel", type: "static", engine: "html", component_ref: "carousel" },
] as const;

async function upsertRenderTemplates(client: ReturnType<typeof createServiceRoleClient>) {
  for (const template of RENDER_TEMPLATES) {
    const { data: existing } = await client
      .from("render_templates")
      .select("id")
      .is("tenant_id", null)
      .eq("name", template.name)
      .maybeSingle();

    if (existing) continue;

    const { error } = await client.from("render_templates").insert({ ...template, status: "active" });
    if (error) throw new Error(`failed to seed render_templates ${template.name}: ${error.message}`);
  }
}

async function upsertDemoBrandKit(client: ReturnType<typeof createServiceRoleClient>, tenantId: string) {
  const { data: existing } = await client
    .from("brand_kits")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) return;

  const { error } = await client.from("brand_kits").insert({
    tenant_id: tenantId,
    color_primary: "#7C6FF0",
    color_secondary: "#FF8B5E",
    tone_description: "cercano, relajado, cálido",
  });
  if (error) throw new Error(`failed to seed brand_kit for tenant ${tenantId}: ${error.message}`);
}

/** One real creative to prove the render pipeline end to end against the seeded demo data. */
async function upsertDemoCreative(client: ReturnType<typeof createServiceRoleClient>, tenantId: string) {
  const { data: existing } = await client
    .from("creatives")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("type", "image")
    .maybeSingle();

  if (existing) return;

  const { data: template } = await client
    .from("render_templates")
    .select("id")
    .eq("name", "social-post")
    .is("tenant_id", null)
    .single();

  if (!template) return;

  const { error } = await client.from("creatives").insert({
    tenant_id: tenantId,
    template_id: template.id,
    type: "image",
    status: "pending",
    brief: {
      headline: "20% en masajes",
      subheadline: "Por Fiestas Patrias — reserva antes del 31 de julio",
      priceLabel: "Desde S/ 96",
    },
  });
  if (error) throw new Error(`failed to seed demo creative for tenant ${tenantId}: ${error.message}`);
}

/** Same brief as the demo image creative, but pointed at the "reel" Remotion composition. */
async function upsertDemoVideoCreative(client: ReturnType<typeof createServiceRoleClient>, tenantId: string) {
  const { data: existing } = await client
    .from("creatives")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("type", "video")
    .maybeSingle();

  if (existing) return;

  const { data: template } = await client
    .from("render_templates")
    .select("id")
    .eq("name", "reel")
    .is("tenant_id", null)
    .single();

  if (!template) return;

  const { error } = await client.from("creatives").insert({
    tenant_id: tenantId,
    template_id: template.id,
    type: "video",
    status: "pending",
    brief: {
      headline: "20% en masajes",
      subheadline: "Por Fiestas Patrias — reserva antes del 31 de julio",
      priceLabel: "Desde S/ 96",
    },
  });
  if (error) throw new Error(`failed to seed demo video creative for tenant ${tenantId}: ${error.message}`);
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

/**
 * Updates the template in place when the row already exists, instead of the
 * skip-if-exists pattern used elsewhere in this file — this prompt is still
 * actively being iterated on (e.g. adding productName for photo selection),
 * and re-seeding is the only way local dev picks up a wording change.
 */
async function upsertCreativePrompt(client: ReturnType<typeof createServiceRoleClient>) {
  const { data: existing } = await client
    .from("prompts")
    .select("id")
    .eq("name", "creative.brief")
    .eq("version", 1)
    .maybeSingle();

  if (existing) {
    const { error } = await client
      .from("prompts")
      .update({ template: CREATIVE_PROMPT_V1 })
      .eq("id", existing.id);
    if (error) throw new Error(`failed to update creative prompt: ${error.message}`);
    return;
  }

  const { error } = await client.from("prompts").insert({
    name: "creative.brief",
    version: 1,
    template: CREATIVE_PROMPT_V1,
    is_active: true,
  });
  if (error) throw new Error(`failed to seed creative prompt: ${error.message}`);
}

/** Same update-in-place pattern as upsertCreativePrompt — still being iterated on. */
async function upsertCarouselPrompt(client: ReturnType<typeof createServiceRoleClient>) {
  const { data: existing } = await client
    .from("prompts")
    .select("id")
    .eq("name", "creative.brief.carousel")
    .eq("version", 1)
    .maybeSingle();

  if (existing) {
    const { error } = await client
      .from("prompts")
      .update({ template: CREATIVE_CAROUSEL_PROMPT_V1 })
      .eq("id", existing.id);
    if (error) throw new Error(`failed to update carousel prompt: ${error.message}`);
    return;
  }

  const { error } = await client.from("prompts").insert({
    name: "creative.brief.carousel",
    version: 1,
    template: CREATIVE_CAROUSEL_PROMPT_V1,
    is_active: true,
  });
  if (error) throw new Error(`failed to seed carousel prompt: ${error.message}`);
}

/** Same update-in-place pattern as upsertCreativePrompt — still being iterated on. */
async function upsertNewsPrompt(client: ReturnType<typeof createServiceRoleClient>) {
  const { data: existing } = await client
    .from("prompts")
    .select("id")
    .eq("name", "news.relevance")
    .eq("version", 1)
    .maybeSingle();

  if (existing) {
    const { error } = await client.from("prompts").update({ template: NEWS_PROMPT_V1 }).eq("id", existing.id);
    if (error) throw new Error(`failed to update news prompt: ${error.message}`);
    return;
  }

  const { error } = await client.from("prompts").insert({
    name: "news.relevance",
    version: 1,
    template: NEWS_PROMPT_V1,
    is_active: true,
  });
  if (error) throw new Error(`failed to seed news prompt: ${error.message}`);
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
  await upsertCreativePrompt(client);
  await upsertCarouselPrompt(client);
  await upsertNewsPrompt(client);
  await upsertAgentsRegistry(client);

  const userA = await upsertUser(client, SEED_USERS.tenantA.email, SEED_USERS.tenantA.password);
  const userB = await upsertUser(client, SEED_USERS.tenantB.email, SEED_USERS.tenantB.password);

  const tenantA = await upsertTenant(client, "spa-demo-a", "Spa Demo A", "spa", userA.id);
  const tenantB = await upsertTenant(client, "spa-demo-b", "Spa Demo B", "spa", userB.id);

  await upsertDemoCatalog(client, tenantA.id);
  await upsertRenderTemplates(client);
  await upsertDemoBrandKit(client, tenantA.id);
  await upsertDemoCreative(client, tenantA.id);
  await upsertDemoVideoCreative(client, tenantA.id);

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
