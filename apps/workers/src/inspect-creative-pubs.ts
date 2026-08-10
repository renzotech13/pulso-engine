import { createServiceRoleClient } from "@pulso/db/worker";

const creativeId = process.argv[2];
if (!creativeId) {
  console.error("usage: tsx src/inspect-creative-pubs.ts <creativeId>");
  process.exit(1);
}

const service = createServiceRoleClient();

const { data: creative, error: creativeError } = await service
  .from("creatives")
  .select("id, tenant_id, calendar_slot_id, type, status, asset_urls")
  .eq("id", creativeId)
  .single();
if (creativeError) throw new Error(creativeError.message);
console.log("creative:", JSON.stringify(creative, null, 2));

if (!creative.calendar_slot_id) {
  console.log("slot: (creative has no calendar_slot_id)");
  process.exit(0);
}

const { data: slot } = await service
  .from("content_calendar")
  .select("id, date, status, published_at, creative_id")
  .eq("id", creative.calendar_slot_id)
  .single();
console.log("slot:", JSON.stringify(slot, null, 2));

const { data: pubs } = await service
  .from("publications")
  .select("id, platform, status, error_message, created_at")
  .eq("creative_id", creativeId)
  .order("created_at", { ascending: false });
console.log("publications:", JSON.stringify(pubs, null, 2));

process.exit(0);
