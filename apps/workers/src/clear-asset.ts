import { createServiceRoleClient } from "@pulso/db/worker";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx src/clear-asset.ts <tenantId>/<creativeId>.png");
  process.exit(1);
}

const service = createServiceRoleClient();
const { error } = await service.storage.from("creative-assets").remove([path]);
if (error) throw new Error(error.message);
console.log("cleared:", path);
process.exit(0);
