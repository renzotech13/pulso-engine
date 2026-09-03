import { createServiceRoleClient } from "@pulso/db/worker";

const tenantId = process.argv[2];
const date = process.argv[3];
if (!tenantId || !date) {
  console.error("usage: tsx src/inspect-slot.ts <tenantId> <date>");
  process.exit(1);
}

const service = createServiceRoleClient();

const { data: slots, error: slotError } = await service
  .from("content_calendar")
  .select("id, date, slot_index, publish_hour, status, slot_type, theme, notes, creative_id")
  .eq("tenant_id", tenantId)
  .eq("date", date)
  .order("slot_index");

if (slotError) {
  console.error("slot query failed:", slotError.message);
  process.exit(1);
}
// A day can hold more than one slot now (see `tenants.publish_hours`), so
// this prints all of them rather than assuming a single row.
console.log("slots:", JSON.stringify(slots, null, 2));

for (const slot of slots ?? []) {
  const { data: creatives, error: creativesError } = await service
    .from("creatives")
    .select("id, type, status, template_id, asset_urls, brief, created_at, updated_at")
    .eq("calendar_slot_id", slot.id)
    .order("created_at", { ascending: false });

  if (creativesError) {
    console.error("creatives query failed:", creativesError.message);
    process.exit(1);
  }
  console.log(`creatives for slot ${slot.slot_index}:`, JSON.stringify(creatives, null, 2));
}

process.exit(0);
