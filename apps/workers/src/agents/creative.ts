import { z } from "zod";
import { createServiceRoleClient, getActivePrompt } from "@pulso/db/worker";
import type { Database, Json } from "@pulso/db/types";
import { publishEvent } from "@pulso/events/publish";
import { loadConfig } from "@pulso/shared/config";
import { callAgentLlm } from "../agent-llm.js";
import { executeAgentRun } from "./base-agent.js";
import {
  buildBriefForComponentRef,
  creativeTypeForTemplateType,
  pickProductPhoto,
  templateNameForSlotType,
  type CreativeCopy,
} from "./creative-helpers.js";
import { generateThemedImage } from "./image-gen.js";

type PromotionRow = Database["public"]["Tables"]["promotions"]["Row"];
type ProductRow = Database["public"]["Tables"]["products_services"]["Row"];

// Local models frequently emit an explicit JSON `null` for a field the
// prompt told them to omit, rather than actually omitting the key —
// .optional() alone only tolerates a missing key, not `null`, so this
// rejected otherwise-valid output until the retry also came back null and
// the whole generation failed. .nullable() plus the transform below let
// both "omitted" and "explicitly null" mean the same thing downstream.
const creativeCopySchema = z
  .object({
    headline: z.string().min(1),
    subheadline: z.string().nullable().optional(),
    priceLabel: z.string().nullable().optional(),
    productName: z.string().nullable().optional(),
  })
  .transform((data) => ({
    headline: data.headline,
    subheadline: data.subheadline ?? undefined,
    priceLabel: data.priceLabel ?? undefined,
    productName: data.productName ?? undefined,
  }));

// Carousel copy is a flat list, not a single headline — first slide is the
// hook, the middle ones are one tip each, and the last is always the
// comment-CTA (enforced by the creative.brief.carousel prompt, not here).
const carouselCopySchema = z
  .object({
    slides: z.array(z.string().min(1)).min(5).max(7),
  })
  .transform((data) => ({ slides: data.slides }));

function renderPrompt(template: string, vars: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function formatPromotions(list: PromotionRow[]): string {
  if (list.length === 0) return "(ninguna activa)";
  return list
    .map((p) => {
      const discount =
        p.discount_type === "percentage" ? `${p.discount_value}%` : `S/ ${p.discount_value}`;
      return `- ${p.name} (${discount}) vigente hasta ${p.ends_at.slice(0, 10)}`;
    })
    .join("\n");
}

function formatProducts(list: ProductRow[]): string {
  if (list.length === 0) return "(sin catálogo cargado)";
  return list.map((p) => `- ${p.name}${p.price ? ` (S/ ${p.price})` : ""}`).join("\n");
}

/**
 * Turns one approved calendar slot into a creative: picks the render
 * template for the slot's type, asks the local LLM for headline/subheadline/
 * priceLabel copy grounded in real products/promotions (plus, if the copy
 * is about a specific catalog product, which one — so a real uploaded
 * photo can be composited instead of just the brand gradient), then
 * inserts the `creatives` row and links it back onto the slot. Never
 * renders anything itself — that stays lazy, triggered the first time
 * someone requests /api/render/{creativeId} (Vía A/B).
 *
 * Every skip path (slot gone, already has a creative, unsupported slot_type,
 * no active template) logs a decision instead of throwing — a stale or
 * duplicate `creative.requested` event should never fail the job.
 */
export async function runCreativeAgentForSlot(
  tenantId: string,
  calendarSlotId: string,
  correlationId: string,
  jobId?: string,
): Promise<void> {
  await executeAgentRun(
    { agent: "creative", tenantId, trigger: "creative.requested", correlationId },
    async (ctx) => {
      const skip = async (rationale: string, observed: Json) => {
        await ctx.db.insertDecisionLog({
          agent: "creative",
          observed,
          decision: { action: "skip" },
          rationale,
          correlation_id: correlationId,
        });
      };

      const slot = await ctx.db.getContentCalendarSlotById(calendarSlotId);
      if (!slot) {
        await skip("El slot del calendario ya no existe.", { calendar_slot_id: calendarSlotId });
        return;
      }

      if (slot.status !== "approved") {
        await skip("El slot ya no está aprobado.", {
          calendar_slot_id: calendarSlotId,
          status: slot.status,
        });
        return;
      }

      const existingCreative = await ctx.db.getCreativeByCalendarSlotId(calendarSlotId);
      if (existingCreative) {
        await skip("Este slot ya tiene un creative generado.", {
          calendar_slot_id: calendarSlotId,
          existing_creative_id: existingCreative.id,
        });
        return;
      }

      const templateName = templateNameForSlotType(slot.slot_type);
      if (!templateName) {
        await skip(`Todavía no hay una plantilla de render para el tipo de slot "${slot.slot_type}".`, {
          calendar_slot_id: calendarSlotId,
          slot_type: slot.slot_type,
        });
        return;
      }

      const template = await ctx.db.getRenderTemplateByName(templateName);
      if (!template || template.status !== "active") {
        await skip(`La plantilla "${templateName}" no está activa o no existe.`, {
          calendar_slot_id: calendarSlotId,
          template_name: templateName,
        });
        return;
      }

      const isCarousel = slot.slot_type === "carousel";
      const promptName = isCarousel ? "creative.brief.carousel" : "creative.brief";

      const service = createServiceRoleClient();
      const config = loadConfig();
      const [tenant, promotions, products, promptTemplate, ephemerides, mediaAssets] = await Promise.all([
        ctx.db.getTenant(),
        ctx.db.listActivePromotions(),
        ctx.db.listActiveProducts(),
        getActivePrompt(service, promptName),
        ctx.db.listEphemerides(),
        ctx.db.listMediaAssets("image"),
      ]);

      // Exact-date match only — the Planner doesn't record which ephemeris (if
      // any) actually inspired a given day's theme, so this is the one
      // reliable way to tell "today's slot lines up with a special date".
      const accentEphemeris = ephemerides.find(
        (e) => e.date === slot.date && e.accent_color_primary && e.accent_color_secondary,
      );
      const colorOverride = accentEphemeris
        ? {
            colorPrimary: accentEphemeris.accent_color_primary!,
            colorSecondary: accentEphemeris.accent_color_secondary!,
          }
        : undefined;

      const instruction = slot.notes?.trim()
        ? `Instrucción adicional del cliente para esta pieza: ${slot.notes.trim()}`
        : "";

      const prompt = renderPrompt(promptTemplate, {
        THEME: slot.theme,
        SLOT_TYPE: slot.slot_type,
        PROMOTIONS: formatPromotions(promotions),
        PRODUCTS: formatProducts(products),
        INSTRUCTION: instruction,
      });

      const copy: CreativeCopy = isCarousel
        ? await callAgentLlm({
            agentName: "creative",
            tenantId,
            ...(jobId ? { jobId } : {}),
            correlationId,
            prompt,
            schema: carouselCopySchema,
          })
        : await callAgentLlm({
            agentName: "creative",
            tenantId,
            ...(jobId ? { jobId } : {}),
            correlationId,
            prompt,
            schema: creativeCopySchema,
          });

      let photoUrl = pickProductPhoto(products, copy.productName);

      // No specific catalog product matched — prefer the tenant's own
      // uploaded photo library over an AI-generated image, since a real
      // photo the tenant chose beats a synthetic one whenever one's
      // available. listMediaAssets already orders oldest/never-used first,
      // so this naturally cycles through every uploaded photo before any
      // gets reused.
      const pickedMediaAsset = !photoUrl ? mediaAssets[0] : undefined;
      if (pickedMediaAsset) {
        photoUrl = pickedMediaAsset.url;
        await ctx.db.markMediaAssetUsed(pickedMediaAsset.id);
      }

      // Still no photo — try an AI-generated one instead of just falling
      // back to the brand gradient. Inactive whenever GEMINI_API_KEY isn't
      // configured (generateThemedImage itself no-ops), so tenants who
      // never set one and never uploaded to their photo library see
      // exactly today's behavior.
      if (!photoUrl && config.GEMINI_API_KEY) {
        const styleHint = accentEphemeris
          ? `Usa colores rojo y blanco (${accentEphemeris.name}), estilo patrio peruano.`
          : "";
        const prompt = [
          `Fotografía profesional de marketing para un negocio de tipo "${tenant.rubro ?? "general"}".`,
          `Tema: ${slot.theme}.`,
          styleHint,
          "Sin texto superpuesto, estilo limpio y corporativo.",
        ]
          .filter(Boolean)
          .join(" ");

        const imageBuffer = await generateThemedImage(prompt);
        if (imageBuffer) {
          const assetPath = `${tenantId}/generated-${calendarSlotId}-${Date.now()}.png`;
          const { error: uploadError } = await service.storage
            .from("creative-assets")
            .upload(assetPath, imageBuffer, { contentType: "image/png" });

          if (!uploadError) {
            const { data: publicUrlData } = service.storage.from("creative-assets").getPublicUrl(assetPath);
            photoUrl = publicUrlData.publicUrl;
          }
        }
      }

      const brief = buildBriefForComponentRef(template.component_ref, copy, photoUrl, colorOverride);

      // template.type only distinguishes static/video (creativeTypeForTemplateType)
      // — carousel is its own creatives.type even though render_templates.type
      // for it is "static" (a carousel is just a set of static images), so it
      // has to be special-cased ahead of that mapping.
      const creativeType = isCarousel
        ? ("carousel" as const)
        : creativeTypeForTemplateType(template.type as "static" | "video");

      const creative = await ctx.db.insertCreative({
        calendar_slot_id: calendarSlotId,
        template_id: template.id,
        type: creativeType,
        status: "pending",
        brief: brief as Json,
      });

      await ctx.db.setCalendarSlotCreative(calendarSlotId, creative.id);

      await ctx.db.insertDecisionLog({
        agent: "creative",
        observed: { calendar_slot_id: calendarSlotId, slot_type: slot.slot_type, theme: slot.theme },
        decision: { creative_id: creative.id, template: templateName },
        rationale: "Copy generado por el LLM local a partir de productos/promociones activos.",
        correlation_id: correlationId,
      });

      await publishEvent(service, {
        tenantId,
        type: "creative.generated",
        payload: { creativeId: creative.id },
        correlationId,
      });

      // approve-creatives and full-auto both want the piece already rendered
      // by the time anyone (human or the publish tick) looks at it, instead
      // of waiting on the first page view. Render failures are logged, not
      // thrown — the creative still exists and can render lazily later,
      // same as today for approve-all tenants.
      if (tenant.hitl_mode !== "approve-all") {
        const extension = creative.type === "video" ? "mp4" : "png";

        try {
          await fetch(`${config.RENDER_TEMPLATES_URL}/api/render/${creative.id}.${extension}`);
        } catch (err) {
          await ctx.db.insertDecisionLog({
            agent: "creative",
            observed: { creative_id: creative.id },
            decision: { action: "eager_render_failed" },
            rationale: err instanceof Error ? err.message : String(err),
            correlation_id: correlationId,
          });
        }

        // Only full-auto skips creative review — approve-creatives still
        // wants a human to look at the rendered piece before it can publish.
        // Order matters here: the render route sets status back to 'ready'
        // on every fresh render, so approving before the fetch above would
        // just get silently overwritten.
        if (tenant.hitl_mode === "full-auto") {
          const rendered = await ctx.db.getCreativeById(creative.id);
          if (rendered?.status === "ready") {
            await ctx.db.updateCreativeStatus(creative.id, "approved");

            // Don't wait for the hourly publish.tick — firing right away is
            // what actually lets a future-dated Facebook post get scheduled
            // with Meta today instead of sitting idle until its date arrives
            // (see publish.ts's isFutureDate branch). Same-day content just
            // publishes for real immediately, exactly as the tick would do.
            await publishEvent(service, {
              tenantId,
              type: "publish.requested",
              payload: { creativeId: creative.id },
              correlationId,
            });
          }
        }
      }
    },
  );
}
