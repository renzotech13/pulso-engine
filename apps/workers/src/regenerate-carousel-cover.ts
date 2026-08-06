import { createServiceRoleClient } from "@pulso/db/worker";
import { generateThemedImage } from "@pulso/shared/image-gen";

const creativeId = process.argv[2];
const prompt = process.argv[3];
if (!creativeId || !prompt) {
  console.error("usage: tsx src/regenerate-carousel-cover.ts <creativeId> <prompt>");
  process.exit(1);
}

const service = createServiceRoleClient();
const { data: creative } = await service
  .from("creatives")
  .select("tenant_id, brief")
  .eq("id", creativeId)
  .single();
if (!creative) throw new Error("not found");

console.log("Generating hook image with Gemini...");
const imageBuffer = await generateThemedImage(prompt);
if (!imageBuffer) {
  console.error("Gemini returned no image — check GEMINI_API_KEY / quota.");
  process.exit(1);
}

const assetPath = `${creative.tenant_id}/generated-manual-${creativeId}-${Date.now()}.png`;
const { error: uploadError } = await service.storage
  .from("creative-assets")
  .upload(assetPath, imageBuffer, { contentType: "image/png" });
if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

const { data: publicUrlData } = service.storage.from("creative-assets").getPublicUrl(assetPath);
const photoUrl = publicUrlData.publicUrl;
console.log("New hook image uploaded:", photoUrl);

const brief = { ...(creative.brief as Record<string, unknown>), photoUrl };
const { error: updateError } = await service
  .from("creatives")
  .update({ brief, status: "pending" })
  .eq("id", creativeId);
if (updateError) throw new Error(`update failed: ${updateError.message}`);

const slides = (creative.brief as { slides?: string[] }).slides ?? [];
const staleAssetPaths = slides.map((_, i) => `${creative.tenant_id}/${creativeId}-${i}.png`);
await service.storage.from("creative-assets").remove(staleAssetPaths);

console.log("done");
process.exit(0);
