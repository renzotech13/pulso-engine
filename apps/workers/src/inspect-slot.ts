import { createServiceRoleClient } from "@pulso/db/worker";

const tenantId = process.argv[2];
const date = process.argv[3];
if (!tenantId || !date) {
  console.error("usage: tsx src/inspect-slot.ts <tenantId> <date>");
  process.exit(1);
}

const service = createServiceRoleClient();

const { data: slot, error: slotError } = await service
  .from("content_calendar")
  .select("id, date, status, slot_type, theme, notes, creative_id")
  .eq("tenant_id", tenantId)
  .eq("date", date)
  .maybeSingle();

if (slotError) {
  console.error("slot query failed:", slotError.message);
  process.exit(1);
}
console.log("slot:", JSON.stringify(slot, null, 2));

if (slot) {
  const { data: creatives, error: creativesError } = await service
    .from("creatives")
    .select("id, type, status, template_id, asset_urls, brief, created_at, updated_at")
    .eq("calendar_slot_id", slot.id)
    .order("created_at", { ascending: false });

  if (creativesError) {
    console.error("creatives query failed:", creativesError.message);
    process.exit(1);
  }
  console.log("creatives:", JSON.stringify(creatives, null, 2));
}

process.exit(0);
