import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@pulso/db/worker";
import { isKnownRemotionRef, REMOTION_REGISTRY } from "@pulso/render-video";
import { screenshotPage } from "@/lib/browser";
import { getCreativeForRender, getRenderTemplateForCreative, resolveBrand } from "@/lib/data";
import { renderRemotionComposition } from "@/lib/remotion-video";
import { TEMPLATE_SIZES, isKnownTemplateRef } from "@/templates/registry";

/**
 * Lazy generation, never batch: nothing renders until someone actually
 * requests it. Cache-Control is aggressive because the asset is immutable
 * once rendered — invalidation happens by deleting the Storage object
 * (creative.data_changed handler, once that event exists), not by expiry.
 *
 * Branches on render_templates.engine: 'html' screenshots the /t/{ref} page
 * with Puppeteer (Vía A); 'remotion' renders a video composition out of
 * process via renderRemotionComposition (Vía B). Carousel is a third shape —
 * still 'html'/Puppeteer, but N slides instead of one, so it gets its own
 * branch that loops screenshotPage and uploads N files instead of one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ creativeId: string }> },
) {
  const { creativeId: rawId } = await params;
  const creativeId = rawId.replace(/\.(png|mp4)$/, "");

  const service = createServiceRoleClient();
  const { data: creative } = await service
    .from("creatives")
    .select("tenant_id, brief")
    .eq("id", creativeId)
    .single();

  if (!creative) return new Response("creative not found", { status: 404 });

  const templateInfo = await getRenderTemplateForCreative(creativeId);
  if (!templateInfo) {
    return new Response("no active template assigned to this creative", { status: 422 });
  }

  const isVideo = templateInfo.engine === "remotion";
  const isCarousel = !isVideo && templateInfo.componentRef === "carousel";
  const isPhotoFrame = !isVideo && templateInfo.componentRef === "photo-frame";

  if (isCarousel) {
    return handleCarouselRender(request, service, creativeId, creative.tenant_id, creative.brief);
  }

  if (isPhotoFrame) {
    return handlePhotoFrameRender(request, service, creativeId, creative.tenant_id, creative.brief, {
      canvasWidth: templateInfo.canvasWidth,
      canvasHeight: templateInfo.canvasHeight,
    });
  }

  const extension = isVideo ? "mp4" : "png";
  const contentType = isVideo ? "video/mp4" : "image/png";
  const filename = `${creativeId}.${extension}`;
  const assetPath = `${creative.tenant_id}/${filename}`;
  const { data: publicUrlData } = service.storage.from("creative-assets").getPublicUrl(assetPath);

  const { data: existingFiles } = await service.storage
    .from("creative-assets")
    .list(creative.tenant_id, { search: filename });

  if (existingFiles?.some((file) => file.name === filename)) {
    return NextResponse.redirect(publicUrlData.publicUrl, {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  // Everything past this point can genuinely fail (Puppeteer/Remotion crash,
  // a bad brief, a Storage hiccup) — any of it should leave the creative
  // visibly 'failed' in the review UI instead of just a swallowed 500.
  try {
    let output: Buffer;

    if (isVideo) {
      if (!isKnownRemotionRef(templateInfo.componentRef)) {
        throw new Response("unknown remotion composition", { status: 422 });
      }

      const result = await getCreativeForRender(creativeId);
      if (!result) throw new Response("creative not found", { status: 404 });

      // Ephemeris-driven accent colors (creative.ts) live as plain
      // colorPrimary/colorSecondary keys on the brief itself — they need to
      // land inside `brand` before validation, since both composition
      // schemas are non-strict Zod objects that would otherwise just
      // silently drop them as unrecognized top-level keys.
      const briefRecord = result.creative.brief as Record<string, unknown>;
      const brand = {
        ...resolveBrand(result.brandKit, result.tenantName),
        ...(typeof briefRecord.colorPrimary === "string" && typeof briefRecord.colorSecondary === "string"
          ? { colorPrimary: briefRecord.colorPrimary, colorSecondary: briefRecord.colorSecondary }
          : {}),
      };
      const parsed = REMOTION_REGISTRY[templateInfo.componentRef].schema.safeParse({
        ...briefRecord,
        brand,
      });

      if (!parsed.success) {
        throw new Response(`invalid brief: ${parsed.error.message}`, { status: 422 });
      }

      output = await renderRemotionComposition(templateInfo.componentRef, parsed.data);
    } else {
      if (!isKnownTemplateRef(templateInfo.componentRef)) {
        throw new Response("no active template assigned to this creative", { status: 422 });
      }

      const origin = new URL(request.url).origin;
      const templateUrl = `${origin}/t/${templateInfo.componentRef}?creative=${creativeId}`;
      output = await screenshotPage(templateUrl, TEMPLATE_SIZES[templateInfo.componentRef]);
    }

    const { error: uploadError } = await service.storage
      .from("creative-assets")
      .upload(assetPath, output, { contentType, upsert: true });

    if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

    await service
      .from("creatives")
      .update({ status: "ready", asset_urls: [publicUrlData.publicUrl] })
      .eq("id", creativeId);

    return NextResponse.redirect(publicUrlData.publicUrl, {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch (err) {
    // Every path here — a bad template/brief as much as a Puppeteer/Remotion
    // crash — is a real problem with this creative that a plain retry won't
    // fix on its own, so all of them mark it 'failed' for the review UI.
    await service.from("creatives").update({ status: "failed" }).eq("id", creativeId);

    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`render failed: ${message}`, { status: 500 });
  }
}

/**
 * One Puppeteer page load per slide (screenshotPage is reused unchanged,
 * just called N times with a different `slide` query param) — simpler than
 * teaching browser.ts to clip multiple screenshots out of one page load, at
 * the cost of N navigations instead of one. Fine for a background job.
 * Files are named `{creativeId}-{i}.png`; the "already rendered" check
 * compares the file count against slides.length instead of a single exact
 * name. The redirect response points at slide 0 (the hook) so anything that
 * requests this URL directly (eager-render fetch, a stray <img> tag) still
 * gets a sensible cover image — the full set lives in `creatives.asset_urls`.
 */
async function handleCarouselRender(
  request: Request,
  service: ReturnType<typeof createServiceRoleClient>,
  creativeId: string,
  tenantId: string,
  brief: unknown,
): Promise<Response> {
  const slides = (brief as { slides?: unknown })?.slides;
  if (!Array.isArray(slides) || slides.length === 0) {
    await service.from("creatives").update({ status: "failed" }).eq("id", creativeId);
    return new Response("invalid brief: missing slides array", { status: 422 });
  }

  const slideCount = slides.length;
  const prefix = `${creativeId}-`;
  const publicUrlFor = (i: number) =>
    service.storage.from("creative-assets").getPublicUrl(`${tenantId}/${prefix}${i}.png`).data.publicUrl;

  const { data: existingFiles } = await service.storage
    .from("creative-assets")
    .list(tenantId, { search: prefix });

  const alreadyRendered =
    (existingFiles?.filter((f) => f.name.startsWith(prefix)).length ?? 0) >= slideCount;

  if (alreadyRendered) {
    return NextResponse.redirect(publicUrlFor(0), {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  try {
    const origin = new URL(request.url).origin;
    const assetUrls: string[] = [];

    for (let i = 0; i < slideCount; i++) {
      const templateUrl = `${origin}/t/carousel?creative=${creativeId}&slide=${i}`;
      const output = await screenshotPage(templateUrl, TEMPLATE_SIZES.carousel);

      const assetPath = `${tenantId}/${prefix}${i}.png`;
      const { error: uploadError } = await service.storage
        .from("creative-assets")
        .upload(assetPath, output, { contentType: "image/png", upsert: true });

      if (uploadError) throw new Error(`upload failed (slide ${i}): ${uploadError.message}`);
      assetUrls.push(publicUrlFor(i));
    }

    await service.from("creatives").update({ status: "ready", asset_urls: assetUrls }).eq("id", creativeId);

    return NextResponse.redirect(assetUrls[0]!, {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch (err) {
    await service.from("creatives").update({ status: "failed" }).eq("id", creativeId);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`render failed: ${message}`, { status: 500 });
  }
}

/**
 * Same one-page-load-per-item pattern as handleCarouselRender, but for real
 * uploaded photos composited under a tenant's own frame instead of
 * LLM-written text slides — a single photo produces a single file (still a
 * loop of length 1), a batch produces a carousel. Canvas size comes from the
 * template row (chosen per tenant when they upload their frame), not the
 * static TEMPLATE_SIZES map every other component uses.
 */
async function handlePhotoFrameRender(
  request: Request,
  service: ReturnType<typeof createServiceRoleClient>,
  creativeId: string,
  tenantId: string,
  brief: unknown,
  canvas: { canvasWidth: number | null; canvasHeight: number | null },
): Promise<Response> {
  const photoUrls = (brief as { photoUrls?: unknown })?.photoUrls;
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
    await service.from("creatives").update({ status: "failed" }).eq("id", creativeId);
    return new Response("invalid brief: missing photoUrls array", { status: 422 });
  }
  if (!canvas.canvasWidth || !canvas.canvasHeight) {
    await service.from("creatives").update({ status: "failed" }).eq("id", creativeId);
    return new Response("template has no canvas size configured", { status: 422 });
  }

  const photoCount = photoUrls.length;
  const prefix = `${creativeId}-`;
  const publicUrlFor = (i: number) =>
    service.storage.from("creative-assets").getPublicUrl(`${tenantId}/${prefix}${i}.png`).data.publicUrl;

  const { data: existingFiles } = await service.storage
    .from("creative-assets")
    .list(tenantId, { search: prefix });

  const alreadyRendered =
    (existingFiles?.filter((f) => f.name.startsWith(prefix)).length ?? 0) >= photoCount;

  if (alreadyRendered) {
    return NextResponse.redirect(publicUrlFor(0), {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  try {
    const origin = new URL(request.url).origin;
    const assetUrls: string[] = [];
    const size = { width: canvas.canvasWidth, height: canvas.canvasHeight };

    for (let i = 0; i < photoCount; i++) {
      const templateUrl = `${origin}/t/photo-frame?creative=${creativeId}&photo=${encodeURIComponent(String(photoUrls[i]))}`;
      const output = await screenshotPage(templateUrl, size);

      const assetPath = `${tenantId}/${prefix}${i}.png`;
      const { error: uploadError } = await service.storage
        .from("creative-assets")
        .upload(assetPath, output, { contentType: "image/png", upsert: true });

      if (uploadError) throw new Error(`upload failed (photo ${i}): ${uploadError.message}`);
      assetUrls.push(publicUrlFor(i));
    }

    await service.from("creatives").update({ status: "ready", asset_urls: assetUrls }).eq("id", creativeId);

    return NextResponse.redirect(assetUrls[0]!, {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch (err) {
    await service.from("creatives").update({ status: "failed" }).eq("id", creativeId);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`render failed: ${message}`, { status: 500 });
  }
}
