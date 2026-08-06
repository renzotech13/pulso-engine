import { createServiceRoleClient } from "@pulso/db/worker";

const calendarSlotId = process.argv[2];
if (!calendarSlotId) {
  console.error("usage: tsx src/reset-slot-creative.ts <calendarSlotId>");
  process.exit(1);
}

const service = createServiceRoleClient();
const { data: slot } = await service
  .from("content_calendar")
  .select("creative_id")
  .eq("id", calendarSlotId)
  .single();
if (!slot?.creative_id) throw new Error("slot has no creative");

await service.from("creatives").delete().eq("id", slot.creative_id);
await service.from("content_calendar").update({ creative_id: null }).eq("id", calendarSlotId);
console.log("cleared creative", slot.creative_id, "from slot", calendarSlotId);
process.exit(0);
