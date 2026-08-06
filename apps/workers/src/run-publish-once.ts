import { newCorrelationId } from "@pulso/shared/ids";
import { runPublishAgentForCreative } from "./agents/publish.js";

const tenantId = process.argv[2];
const creativeId = process.argv[3];
if (!tenantId || !creativeId) {
  console.error("usage: tsx src/run-publish-once.ts <tenantId> <creativeId>");
  process.exit(1);
}

await runPublishAgentForCreative(tenantId, creativeId, newCorrelationId());
console.log("done");
process.exit(0);
