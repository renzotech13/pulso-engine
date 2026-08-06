import { newCorrelationId } from "@pulso/shared/ids";
import { runNewsAgentForTenant } from "./agents/news.js";

const tenantId = process.argv[2];
if (!tenantId) {
  console.error("usage: tsx src/run-news-once.ts <tenantId>");
  process.exit(1);
}

await runNewsAgentForTenant(tenantId, newCorrelationId());
console.log("done");
process.exit(0);
