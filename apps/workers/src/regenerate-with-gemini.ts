import { createServiceRoleClient } from "@pulso/db/worker";
import { generateThemedImage } from "@pulso/shared/image-gen";

const creativeId = process.argv[2];
const promptOverride = process.argv[3];
if (!creativeId || !promptOverride) {
  console.error("usage: tsx src/regenerate-with-gemini.ts <creativeId> <prompt>");
  process.exit(1);
}

const service = createServiceRoleClient();

const { data: creative, error: fetchError } = await service
  .from("creatives")
  .select("tenant_id, brief")
  .eq("id", creativeId)
  .single();
if (fetchError || !creative) throw new Error(fetchError?.message ?? "creative not found");

console.log("Generating with Gemini...");
const imageBuffer = await generateThemedImage(promptOverride);
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
console.log("New Gemini image uploaded:", photoUrl);

const brief = { ...(creative.brief as Record<string, unknown>), photoUrl };
const { error: updateError } = await service
  .from("creatives")
  .update({ brief, status: "pending" })
  .eq("id", creativeId);
if (updateError) throw new Error(`update failed: ${updateError.message}`);

// Force a real re-render: the render route's "already rendered" check for a
// plain (non-carousel) image just checks whether {creativeId}.png already
// exists — true here, since the first render is still sitting there — so
// without removing it first, hitting the render endpoint again would just
// redirect to the stale file instead of compositing the new photo.
const staleAssetPath = `${creative.tenant_id}/${creativeId}.png`;
await service.storage.from("creative-assets").remove([staleAssetPath]);

console.log("done");
process.exit(0);
