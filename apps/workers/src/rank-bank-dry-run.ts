import { createServiceRoleClient, createTenantScopedClient } from "@pulso/db/worker";
import { limaDatePlusDays, limaToday } from "@pulso/shared/time";
import {
  BANK_STRONG_MATCH,
  BANK_WEAK_MATCH,
  decidePhotoSource,
  rankBankPhotos,
  type PhotoSource,
} from "./agents/creative-helpers.js";

/**
 * Shows, for a tenant's next two weeks of morning slots, which bank photos
 * the ranking would pick and what the bank-vs-Gemini rule would decide.
 * Zero Gemini or LLM calls, writes nothing — for tuning THEME_SYNONYMS and
 * the two thresholds against a real bank before trusting the policy.
 *
 * usage: tsx src/rank-bank-dry-run.ts <tenantSlug>
 */
const [slug] = process.argv.slice(2);
if (!slug) {
  console.error("usage: tsx src/rank-bank-dry-run.ts <tenantSlug>");
  process.exit(1);
}

const service = createServiceRoleClient();
const { data: tenant } = await service
  .from("tenants")
  .select("id, name, gemini_share, gemini_daily_image_budget")
  .eq("slug", slug)
  .maybeSingle();
if (!tenant) throw new Error(`no tenant with slug "${slug}"`);

const db = createTenantScopedClient(tenant.id, service);
const [assets, slots, recent] = await Promise.all([
  db.listMediaAssets("image"),
  db.listContentCalendar(limaToday(), limaDatePlusDays(limaToday(), 14)),
  db.listRecentPhotoSources(5),
]);

const tagged = assets.filter((a) => a.tagged_at).length;
console.log(`${tenant.name}: ${assets.length} fotos en el banco (${tagged} etiquetadas) · gemini_share=${tenant.gemini_share ?? "null"} · budget=${tenant.gemini_daily_image_budget ?? "null"}`);
console.log(`umbrales: fuerte ≥ ${BANK_STRONG_MATCH}, débil < ${BANK_WEAK_MATCH}\n`);

const recentSources = recent.map((r) => r.source as PhotoSource);
const now = new Date();

for (const slot of slots.filter((s) => s.slot_index === 0)) {
  const ranked = rankBankPhotos(assets, { texts: [slot.theme], now, preferPortrait: slot.slot_type !== "post" });
  const decision = decidePhotoSource({
    bestBankScore: ranked[0]?.score ?? null,
    geminiAvailable: true,
    recentSources,
    geminiShare: tenant.gemini_share,
  });
  console.log(`${slot.date} [${slot.slot_type}] → ${decision.toUpperCase()}  ·  ${slot.theme}`);
  for (const r of ranked.slice(0, 3)) {
    const name = decodeURIComponent(r.asset.url.split("/").pop() ?? "").replace(/^library-[0-9a-f-]{36}-/, "");
    console.log(`     ${r.score.toFixed(2)}  ${name.slice(0, 60)}  [${r.matched.join(", ")}]`);
  }
}
process.exit(0);
