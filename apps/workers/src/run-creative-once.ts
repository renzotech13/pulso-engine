import { newCorrelationId } from "@pulso/shared/ids";
import { runCreativeAgentForSlot } from "./agents/creative.js";

const tenantId = process.argv[2];
const calendarSlotId = process.argv[3];
if (!tenantId || !calendarSlotId) {
  console.error("usage: tsx src/run-creative-once.ts <tenantId> <calendarSlotId>");
  process.exit(1);
}

await runCreativeAgentForSlot(tenantId, calendarSlotId, newCorrelationId());
console.log("done");
process.exit(0);
