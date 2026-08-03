import { createServiceRoleClient } from "@pulso/db/worker";

const DEFAULT_BRAND = { colorPrimary: "#7C6FF0", colorSecondary: "#FF8B5E" };

/** Shared by the Puppeteer (html) and Remotion (video) render paths so both fall back the same way. */
export function resolveBrand(
  brandKit: { logo_url: string | null; color_primary: string | null; color_secondary: string | null } | null,
  tenantName: string,
) {
  return {
    logoUrl: brandKit?.logo_url ?? null,
    colorPrimary: brandKit?.color_primary ?? DEFAULT_BRAND.colorPrimary,
    colorSecondary: brandKit?.color_secondary ?? DEFAULT_BRAND.colorSecondary,
    tenantName,
  };
}

/**
 * This app never has a signed-in user — it's fetched by Puppeteer, not
 * browsed by a person — so every read goes through the service-role client
 * directly (no RLS-scoped user session to build one from).
 */
export async function getCreativeForRender(creativeId: string) {
  const service = createServiceRoleClient();

  const { data: creative, error: creativeError } = await service
    .from("creatives")
    .select("*")
    .eq("id", creativeId)
    .single();

  if (creativeError || !creative) return null;

  const { data: brandKit } = await service
    .from("brand_kits")
    .select("*")
    .eq("tenant_id", creative.tenant_id)
    .maybeSingle();

  const { data: tenant } = await service
    .from("tenants")
    .select("name")
    .eq("id", creative.tenant_id)
    .single();

  return { creative, brandKit, tenantName: tenant?.name ?? "" };
}

/** What the render API needs to pick a renderer: which engine, and which component/composition. */
export async function getRenderTemplateForCreative(creativeId: string): Promise<{
  engine: string;
  componentRef: string;
  frameImageUrl: string | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
} | null> {
  const service = createServiceRoleClient();

  const { data: creative } = await service
    .from("creatives")
    .select("template_id")
    .eq("id", creativeId)
    .single();

  if (!creative?.template_id) return null;

  const { data: template } = await service
    .from("render_templates")
    .select("engine, component_ref, frame_image_url, canvas_width, canvas_height")
    .eq("id", creative.template_id)
    .single();

  if (!template) return null;

  return {
    engine: template.engine,
    componentRef: template.component_ref,
    frameImageUrl: template.frame_image_url,
    canvasWidth: template.canvas_width,
    canvasHeight: template.canvas_height,
  };
}

/** The /t/photo-frame page needs the frame image + canvas size for a given render_templates row id. */
export async function getPhotoFrameConfig(
  templateId: string,
): Promise<{ frameImageUrl: string; width: number; height: number } | null> {
  const service = createServiceRoleClient();

  const { data: template } = await service
    .from("render_templates")
    .select("frame_image_url, canvas_width, canvas_height")
    .eq("id", templateId)
    .single();

  if (!template?.frame_image_url || !template.canvas_width || !template.canvas_height) return null;

  return {
    frameImageUrl: template.frame_image_url,
    width: template.canvas_width,
    height: template.canvas_height,
  };
}
