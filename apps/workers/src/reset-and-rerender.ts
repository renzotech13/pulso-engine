import { createServiceRoleClient } from "@pulso/db/worker";

const creativeId = process.argv[2];
const ext = process.argv[3] ?? "png";
if (!creativeId) {
  console.error("usage: tsx src/reset-and-rerender.ts <creativeId> [ext]");
  process.exit(1);
}
const service = createServiceRoleClient();

const { data: creative } = await service.from("creatives").select("tenant_id").eq("id", creativeId).single();
if (!creative) throw new Error("not found");

const staleAssetPath = `${creative.tenant_id}/${creativeId}.${ext}`;
await service.storage.from("creative-assets").remove([staleAssetPath]);
console.log("removed stale asset, ready to re-render:", staleAssetPath);
process.exit(0);
