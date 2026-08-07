import { createServiceRoleClient } from "@pulso/db/worker";
import { renderLocal } from "./render";
import { REMOTION_REGISTRY, isKnownRemotionRef } from "./registry";

// Vercel's serverless runtime can't run the video render step today —
// apps/render-templates/src/lib/remotion-video.ts spawns `npx tsx cli.ts`
// to keep @remotion/bundler out of Next's own webpack build, but Next's
// file tracing doesn't follow pnpm's symlinks deep enough to ship
// @remotion/bundler/@remotion/renderer (plus their own transitive deps)
// into the deployed function, and even fixed, the packaged size (Remotion's
// own headless Chromium alone is ~190MB locally) would likely blow past
// Vercel's function size limit anyway. Real fix is Remotion Lambda or a
// persistent server for this one step — until then, this renders locally
// (same as content generation already requires, since LM Studio is
// local-only too) and uploads the result directly, bypassing the Next.js
// route entirely. Lives in this package (not apps/workers) specifically so
// it can use bare relative imports to ./render and ./registry — apps/workers'
// tsconfig requires explicit .js extensions on relative imports (NodeNext),
// but Remotion's own webpack bundler resolves imports literally and breaks
// on an explicit ".js" pointing at a ".ts" file, so those two constraints
// can't both be satisfied by the same import statement.
const creativeId = process.argv[2];
if (!creativeId) {
  console.error("usage: tsx src/render-once.ts <creativeId>");
  process.exit(1);
}

const DEFAULT_BRAND = { colorPrimary: "#7C6FF0", colorSecondary: "#FF8B5E" };

const service = createServiceRoleClient();

const { data: creative, error: creativeError } = await service
  .from("creatives")
  .select("id, tenant_id, template_id, type, brief")
  .eq("id", creativeId)
  .single();
if (creativeError || !creative) throw new Error(creativeError?.message ?? "creative not found");
if (creative.type !== "video") throw new Error(`creative ${creativeId} is type "${creative.type}", not video`);
if (!creative.template_id) throw new Error("creative has no template_id");

const { data: template, error: templateError } = await service
  .from("render_templates")
  .select("engine, component_ref")
  .eq("id", creative.template_id)
  .single();
if (templateError || !template) throw new Error(templateError?.message ?? "template not found");
if (template.engine !== "remotion") throw new Error(`template engine is "${template.engine}", not remotion`);
if (!isKnownRemotionRef(template.component_ref)) {
  throw new Error(`unknown remotion composition: ${template.component_ref}`);
}

const [{ data: brandKit }, { data: tenant }] = await Promise.all([
  service
    .from("brand_kits")
    .select("logo_url, color_primary, color_secondary")
    .eq("tenant_id", creative.tenant_id)
    .maybeSingle(),
  service.from("tenants").select("name").eq("id", creative.tenant_id).single(),
]);

const brand = {
  logoUrl: brandKit?.logo_url ?? null,
  colorPrimary: brandKit?.color_primary ?? DEFAULT_BRAND.colorPrimary,
  colorSecondary: brandKit?.color_secondary ?? DEFAULT_BRAND.colorSecondary,
  tenantName: tenant?.name ?? "",
};

const briefRecord = creative.brief as Record<string, unknown>;
const parsed = REMOTION_REGISTRY[template.component_ref].schema.safeParse({
  ...briefRecord,
  brand: {
    ...brand,
    ...(typeof briefRecord.colorPrimary === "string" && typeof briefRecord.colorSecondary === "string"
      ? { colorPrimary: briefRecord.colorPrimary, colorSecondary: briefRecord.colorSecondary }
      : {}),
  },
});
if (!parsed.success) throw new Error(`invalid brief: ${parsed.error.message}`);

console.log("Rendering locally (this can take 30-90s)...");
const output = await renderLocal(template.component_ref, parsed.data);
console.log(`Rendered ${output.length} bytes`);

const assetPath = `${creative.tenant_id}/${creativeId}.mp4`;
const { error: uploadError } = await service.storage
  .from("creative-assets")
  .upload(assetPath, output, { contentType: "video/mp4", upsert: true });
if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

const { data: publicUrlData } = service.storage.from("creative-assets").getPublicUrl(assetPath);

const { error: updateError } = await service
  .from("creatives")
  .update({ status: "ready", asset_urls: [publicUrlData.publicUrl] })
  .eq("id", creativeId);
if (updateError) throw new Error(updateError.message);

console.log("done:", publicUrlData.publicUrl);
process.exit(0);
