import { z } from "zod";
import { createServiceRoleClient, getActivePrompt } from "@pulso/db/worker";
import type { Database, Json } from "@pulso/db/types";
import { publishEvent } from "@pulso/events/publish";
import { loadConfig } from "@pulso/shared/config";
import { AppError } from "@pulso/shared/errors";
import { callAgentLlm } from "../agent-llm.js";
import { executeAgentRun } from "@pulso/publish/base-agent";
import {
  BANK_STRONG_MATCH,
  BANK_WEAK_MATCH,
  buildBriefForComponentRef,
  creativeTypeForTemplateType,
  decidePhotoSource,
  findBannedPhrase,
  findEmDash,
  limitHashtags,
  pickProductPhoto,
  rankBankPhotos,
  stripTrailingHashtags,
  templateNameForSlotType,
  type BankPhotoLookup,
  type CreativeCopy,
  type PhotoMeta,
  type PhotoSource,
} from "./creative-helpers.js";
import { generateThemedImageDetailed, type ImageAspectRatio } from "@pulso/shared/image-gen";
import { imageHasText } from "@pulso/shared/image-describe";
import {
  buildCarouselSlideImagePrompt,
  buildNewsImagePrompt,
  buildPostImagePrompt,
} from "@pulso/shared/image-prompts";

type PromotionRow = Database["public"]["Tables"]["promotions"]["Row"];
type ProductRow = Database["public"]["Tables"]["products_services"]["Row"];

// Local models frequently emit an explicit JSON `null` for a field the
// prompt told them to omit, rather than actually omitting the key —
// .optional() alone only tolerates a missing key, not `null`, so this
// rejected otherwise-valid output until the retry also came back null and
// the whole generation failed. .nullable() plus the transform below let
// both "omitted" and "explicitly null" mean the same thing downstream.
const videoEffectsSchema = z
  .object({
    hideLogo: z.boolean().nullable().optional(),
    zoomOutBackground: z.boolean().nullable().optional(),
    fadeInOverlay: z.boolean().nullable().optional(),
  })
  .nullable()
  .optional();

/** Facebook's caption never carries hashtags and Instagram's carries at most 8 — enforced here, not just asked for in the prompt. */
function splitCaptions(caption: string | null | undefined, captionInstagram: string | null | undefined) {
  const facebook = caption ? stripTrailingHashtags(caption) : "";
  const instagram = captionInstagram ? limitHashtags(captionInstagram) : "";
  return { caption: facebook || undefined, captionInstagram: instagram || undefined };
}

const creativeCopySchema = z
  .object({
    headline: z.string().min(1),
    subheadline: z.string().nullable().optional(),
    priceLabel: z.string().nullable().optional(),
    productName: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    captionInstagram: z.string().nullable().optional(),
    videoEffects: videoEffectsSchema,
    // Advisory scene words for the background photo — never required, never
    // retried on: the ranking works from theme + headline without them.
    imageKeywords: z.array(z.string()).nullable().optional(),
  })
  .transform((data) => ({
    headline: data.headline,
    subheadline: data.subheadline ?? undefined,
    priceLabel: data.priceLabel ?? undefined,
    productName: data.productName ?? undefined,
    ...splitCaptions(data.caption, data.captionInstagram),
    imageKeywords: (data.imageKeywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 6),
    videoEffects: data.videoEffects
      ? {
          hideLogo: data.videoEffects.hideLogo ?? undefined,
          zoomOutBackground: data.videoEffects.zoomOutBackground ?? undefined,
          fadeInOverlay: data.videoEffects.fadeInOverlay ?? undefined,
        }
      : undefined,
  }));

// Carousel copy is a flat list, not a single headline — first slide is the
// hook, the middle ones are one tip each, and the last is always the
// comment-CTA (enforced by the creative.brief.carousel prompt, not here).
const carouselCopySchema = z
  .object({
    slides: z.array(z.string().min(1)).min(4).max(5),
    caption: z.string().nullable().optional(),
    captionInstagram: z.string().nullable().optional(),
  })
  .transform((data) => ({ slides: data.slides, ...splitCaptions(data.caption, data.captionInstagram) }));

// Rejecting a banned phrase at the SCHEMA layer is what makes it a real
// guard: callLlmStructured treats a failed parse exactly like malformed
// JSON and re-prompts the model with the issue message, so the retry names
// the offending phrase and field. Stating the ban in the prompt alone was
// already tried — the brand kit said "never 'sin sustos'" twice and a real
// piece came back with it anyway.
function withCopyGuards<S extends z.ZodTypeAny>(schema: S, bannedPhrases: readonly string[]) {
  return schema.superRefine((copy, ctx) => {
    const record = copy as Record<string, unknown>;
    const banned = findBannedPhrase(record, bannedPhrases);
    if (banned) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `el campo "${banned.field}" contiene la frase prohibida "${banned.phrase}" — reescríbelo sin usarla ni ninguna variante`,
      });
      return; // one issue per attempt keeps the retry prompt focused
    }
    // Universal, not tenant-specific: every copy prompt already asks for
    // this, so it applies regardless of banned_phrases being empty.
    const dash = findEmDash(record);
    if (dash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `el campo "${dash.field}" usa la raya "—" (em dash), que está prohibida en todo el contenido — reescríbelo separando las ideas con punto seguido o coma`,
      });
    }
  });
}

// Two extra attempts (three total) instead of the default one: a content
// rejection is a harder ask than fixing JSON shape, and the model is local,
// so the retries cost time but no money.
const COPY_MAX_RETRIES = 2;

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

      const tenant = await ctx.db.getTenant();

      // "hasta nuevo aviso" switch (tenants.generation_paused) — unlike
      // `status` (a global kill switch that also stops publish-tick from
      // sending out already-ready creatives) this only stops NEW ones from
      // being made; whatever's already generated for this tenant still
      // publishes on schedule.
      if (tenant.generation_paused) {
        await skip("Generación de creatives en pausa para este tenant (tenants.generation_paused).", {
          calendar_slot_id: calendarSlotId,
        });
        return;
      }

      // "hasta nuevo aviso" switch (tenants.reels_paused) — real reel bugs
      // are still open, so instead of leaving these slots stuck forever
      // (they were already approved as 'reel' weeks out by the Planner, not
      // just newly proposed ones), reassign to 'post' and generate that
      // instead. Content still goes out on schedule; nothing renders a reel
      // while this is on.
      if (slot.slot_type === "reel" && tenant.reels_paused) {
        await ctx.db.updateCalendarSlotType(calendarSlotId, "post");
        slot.slot_type = "post";
        await ctx.db.insertDecisionLog({
          agent: "creative",
          observed: { calendar_slot_id: calendarSlotId, original_slot_type: "reel" },
          decision: { action: "reassign_slot_type", slot_type: "post" },
          rationale: "Reels en pausa para este tenant (tenants.reels_paused) — se genera un post en su lugar.",
          correlation_id: correlationId,
        });
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
      const [brandKit, promotions, products, promptTemplate, ephemerides, mediaAssets] = await Promise.all([
        ctx.db.getBrandKit(),
        ctx.db.listActivePromotions(),
        ctx.db.listActiveProducts(),
        getActivePrompt(service, promptName),
        ctx.db.listEphemerides(),
        ctx.db.listMediaAssets("image"),
      ]);

      // Tenant-authored guidance (tone preset + free-text "entrenamiento" from
      // Brand Kit) that every copy AND image prompt below folds in — the only
      // place a tenant can steer the agents' voice beyond the theme/catalog.
      const brandVoiceParts = [brandKit?.tone_description, brandKit?.voice_training].filter(
        (part): part is string => Boolean(part?.trim()),
      );
      const brandTraining = brandVoiceParts.length > 0 ? brandVoiceParts.join("\n") : undefined;
      const brandTrainingForCopy = brandTraining
        ? `Indicaciones de la marca (tenlas en cuenta siempre): ${brandTraining}`
        : "";
      // Images get ONLY the art direction. The copywriting voice (CTAs, the
      // brand sign-off, "Soy Angel Zegarra…") was reaching the image model
      // as 11.000 characters of instructions-to-write, and it painted those
      // very phrases into a real published post. Falls back to the old
      // behaviour for a tenant that hasn't filled art_direction in.
      const artDirection = brandKit?.art_direction?.trim() || brandTraining;

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

      // The News agent stores the original headline as source.rationale when
      // it creates the slot (see useNewsSuggestionAction) — this is the only
      // signal creative.ts has that this piece is grounded in a real news
      // story instead of a Planner-invented theme.
      const newsSource = slot.source as { agent?: string; rationale?: string } | null;
      const newsHeadline = newsSource?.agent === "news" ? newsSource.rationale : undefined;

      const newsContext = newsHeadline
        ? `\nEsta pieza está inspirada en una noticia real: "${newsHeadline}". En el campo "caption" (el texto de la publicación, no el de la imagen), explica por qué esta noticia le importa a un negocio de tipo "${tenant.rubro ?? "general"}" llamado "${tenant.name}", cierra conectándola con el negocio (usa el nombre "${tenant.name}" tal cual, nunca un placeholder como "[Nombre del Negocio]"), y menciona que la fuente es una noticia reciente. No inventes datos que no estén en el tema de arriba.`
        : "";

      // Only reels have real visual effects a template can act on today
      // (hide the logo, zoom out the background, fade in the color overlay)
      // — asking for this on a static post/story would just add a dead JSON
      // key no template reads.
      const videoEffectsInstruction =
        slot.slot_type === "reel"
          ? `\nEste reel soporta estos efectos visuales opcionales, agrégalos al campo "videoEffects" SOLO si la instrucción del cliente arriba los pide explícitamente (si no dice nada de esto, omite el campo por completo): "hideLogo" (quita el logo de la marca), "zoomOutBackground" (la foto de fondo empieza más cerca y se aleja durante el video), "fadeInOverlay" (la sombra de color entra con un fundido en vez de aparecer de golpe).`
          : "";

      const prompt = renderPrompt(promptTemplate, {
        THEME: slot.theme,
        SLOT_TYPE: slot.slot_type,
        PROMOTIONS: formatPromotions(promotions),
        PRODUCTS: formatProducts(products),
        INSTRUCTION: instruction,
        NEWS_CONTEXT: newsContext,
        VIDEO_EFFECTS_INSTRUCTION: videoEffectsInstruction,
        BRAND_TRAINING: brandTrainingForCopy,
      });

      const bannedPhrases = brandKit?.banned_phrases ?? [];
      let copy: CreativeCopy;
      try {
        copy = isCarousel
          ? await callAgentLlm({
              agentName: "creative",
              tenantId,
              ...(jobId ? { jobId } : {}),
              correlationId,
              prompt,
              schema: withCopyGuards(carouselCopySchema, bannedPhrases),
              options: { maxRetries: COPY_MAX_RETRIES },
            })
          : await callAgentLlm({
              agentName: "creative",
              tenantId,
              ...(jobId ? { jobId } : {}),
              correlationId,
              prompt,
              schema: withCopyGuards(creativeCopySchema, bannedPhrases),
              options: { maxRetries: COPY_MAX_RETRIES },
            });
      } catch (err) {
        // Every attempt came back unusable (malformed JSON or a banned phrase
        // the model kept repeating). Throwing here would strand the slot: the
        // outbox event is already marked dispatched and the BullMQ job has a
        // single attempt, so nothing would ever retry it and the calendar
        // would show "generando…" forever. Skip like the other dead-end
        // paths above and make it visible instead — render-tick re-requests
        // approved slots that still have no creative (bounded per day), and
        // the alert tells a human why this one keeps failing.
        if (!(err instanceof AppError && err.code === "LLM_OUTPUT_INVALID")) throw err;
        await skip(`La copy fue rechazada en ${COPY_MAX_RETRIES + 1} intentos: ${err.message}`, {
          calendar_slot_id: calendarSlotId,
          theme: slot.theme,
          action: "copy_rejected",
        });
        await service.from("alerts").insert({
          tenant_id: tenantId,
          severity: "warning",
          type: "creative_copy_rejected",
          message: `La pieza del ${slot.date} ("${slot.theme}") no pudo redactarse: ${err.message}`,
        });
        return;
      }

      // ── Photo ─────────────────────────────────────────────────────────
      // The bank used to rotate blindly by last_used_at; now every photo
      // carries tags (media-tag-tick.ts) and the pick is a keyword ranking
      // in code, with bank-vs-Gemini decided by a deterministic rule under a
      // daily Gemini budget. Every outcome is stamped on the brief and the
      // decision log — nothing here depends on the local model.
      const [recentPhotoSources, geminiUsedToday] = await Promise.all([
        ctx.db.listRecentPhotoSources(5),
        ctx.db.countGeminiImagesToday(),
      ]);
      const recentSources = recentPhotoSources.map((r) => r.source as PhotoSource);
      const lastAssetId = recentPhotoSources.find((r) => r.assetId)?.assetId;
      // `?? []` / `?? null`: on a database where migration 27 hasn't landed
      // yet these columns are simply absent from select("*"), and the whole
      // block then degrades to the legacy behaviour instead of crashing.
      const bankAssets: BankPhotoLookup[] = mediaAssets.map((asset) => ({ ...asset, tags: asset.tags ?? [] }));
      const geminiShare = tenant.gemini_share ?? null;
      const geminiDailyBudget = tenant.gemini_daily_image_budget ?? null;
      const now = new Date();
      const rubro = tenant.rubro ?? "general";
      const isNewsSourced = Boolean(newsHeadline);
      const aspect: ImageAspectRatio = isCarousel || slot.slot_type === "post" ? "1:1" : "9:16";
      const preferPortrait = !isCarousel && slot.slot_type !== "post";

      let geminiUsedThisRun = 0;
      const geminiAvailable = () =>
        Boolean(config.GEMINI_API_KEY) &&
        (geminiDailyBudget === null ||
          geminiUsedToday + geminiUsedThisRun < geminiDailyBudget);

      // Every Gemini image call leaves an agent_calls row (agent_id null, like
      // blocked LLM calls do) — that is what the daily budget counts and what
      // makes rate limits and failures visible at all.
      // Two attempts, because "no text" is the rule Gemini actually breaks:
      // a real post went out with the brand's own CTA painted into the photo
      // and misspelled. The wording alone is not a guarantee, so the picture
      // is inspected before it is accepted — same posture as the
      // banned-phrase guard on the copy. A check that itself errors means
      // "unknown" and the image is kept: losing it to an API hiccup would be
      // worse than the occasional slip.
      const IMAGE_ATTEMPTS = 2;
      const generateAndUpload = async (prompt: string, suffix: string): Promise<string | undefined> => {
        for (let attempt = 0; attempt < IMAGE_ATTEMPTS; attempt++) {
          if (!geminiAvailable()) return undefined;
          const result = await generateThemedImageDetailed(prompt, { aspectRatio: aspect });
          await ctx.db.insertAgentCall({
            agent_id: null,
            agent_name: "gemini-image",
            job_id: jobId ?? null,
            correlation_id: correlationId,
            status: result.ok ? "success" : "error",
            latency_ms: result.latencyMs,
            ...(result.ok ? {} : { error_message: result.error }),
          });
          if (!result.ok) return undefined;
          geminiUsedThisRun++;

          const check = await imageHasText(result.buffer);
          if (check.ok && check.hasText) {
            await ctx.db.insertDecisionLog({
              agent: "creative",
              observed: { calendar_slot_id: calendarSlotId, attempt: attempt + 1, sample: check.sample },
              decision: { action: "image_rejected_has_text" },
              rationale: `Gemini dibujó texto en la imagen ("${check.sample}"), se descarta y se reintenta.`,
              correlation_id: correlationId,
            });
            continue;
          }

          const assetPath = `${tenantId}/generated-${calendarSlotId}${suffix}-${Date.now()}.png`;
          const { error: uploadError } = await service.storage
            .from("creative-assets")
            .upload(assetPath, result.buffer, { contentType: "image/png" });
          if (uploadError) return undefined;
          return service.storage.from("creative-assets").getPublicUrl(assetPath).data.publicUrl;
        }
        return undefined;
      };

      let photoUrl: string | undefined;
      let carouselPhotoUrls: Array<string | undefined> | undefined;
      let photoMeta: PhotoMeta = { photoSource: "gradient" };
      let bankScore: number | undefined;
      let photoReason = "Degradado: sin foto";

      if (isCarousel) {
        // Only the cover (the scroll-stopping hook) is Gemini-first — it's
        // the slide least likely to have a matching bank photo and the one
        // that most needs a bespoke image. Every other slide (middle tips
        // AND the closing CTA) tries the bank first regardless of whether
        // gemini_share is configured: a tenant that never touched that
        // setting should still get bank photos in carousels, not an
        // unconditional Gemini call per slide (gemini_share only widens how
        // often Gemini steps in when the bank has nothing, same as the
        // single-post path). Sequential, not parallel: the image endpoint
        // has hit real per-minute rate limits before.
        const slides = copy.slides ?? [];
        const usedInCarousel: string[] = [];
        const urls: Array<string | undefined> = [];
        const sources: PhotoSource[] = [];
        const assetIds: Array<string | undefined> = [];

        for (const [i, slideText] of slides.entries()) {
          const isCover = i === 0;
          const best = rankBankPhotos(bankAssets, {
            texts: [slot.theme],
            hints: [slideText],
            now,
            excludeIds: usedInCarousel,
          })[0];
          let url: string | undefined;
          let source: PhotoSource = "gradient";
          let assetId: string | undefined;

          if (!isCover && best && best.score >= BANK_STRONG_MATCH) {
            url = best.asset.url;
            source = "bank";
            assetId = best.asset.id;
          }
          if (!url && geminiAvailable()) {
            url = await generateAndUpload(
              buildCarouselSlideImagePrompt({ rubro, theme: slot.theme, slideText, artDirection }),
              `-slide${i}`,
            );
            if (url) source = "gemini";
          }
          if (!url && best && best.score >= BANK_WEAK_MATCH) {
            url = best.asset.url;
            source = "bank";
            assetId = best.asset.id;
          }
          if (source === "bank" && assetId) {
            usedInCarousel.push(assetId);
            await ctx.db.markMediaAssetUsed(assetId);
          }
          urls.push(url);
          sources.push(source);
          assetIds.push(assetId);
        }

        carouselPhotoUrls = urls;
        const count = (kind: PhotoSource) => sources.filter((sourceKind) => sourceKind === kind).length;
        photoMeta = {
          photoSource: count("gemini") > 0 ? "gemini" : count("bank") > 0 ? "bank" : "gradient",
          photoSources: sources,
          photoAssetIds: assetIds,
        };
        photoReason = `Carrusel: ${count("gemini")} Gemini, ${count("bank")} banco, ${count("gradient")} degradado`;
      } else {
        const productPhoto = pickProductPhoto(products, copy.productName);
        const keywords = copy.imageKeywords ?? [];
        const excludeIds = lastAssetId ? [lastAssetId] : [];

        if (productPhoto) {
          photoUrl = productPhoto;
          photoMeta = { photoSource: "product" };
          photoReason = `Foto del catálogo (${copy.productName})`;
        } else if (isNewsSourced) {
          // News pieces are GENERATED, never taken from the bank. A story is
          // about one specific event — the Niño weather phenomenon, a change
          // to the PCGE — and a stock photo of an office is at best
          // unrelated to it. The bank fallback used to fire whenever Gemini
          // slipped and put a barely-related photo (score 0.14) on a piece
          // about accounting-standard changes; a plain gradient is more
          // honest than a photo that has nothing to do with the news.
          if (geminiAvailable()) {
            photoUrl = await generateAndUpload(
              buildNewsImagePrompt({ rubro, theme: slot.theme, headline: newsHeadline ?? slot.theme, artDirection }),
              "",
            );
          }
          if (photoUrl) {
            photoMeta = { photoSource: "gemini" };
            photoReason = "Gemini: pieza de noticias";
          } else {
            photoReason = "Degradado: pieza de noticias sin imagen generada (el banco no se usa para noticias)";
          }
        } else {
          const best = rankBankPhotos(bankAssets, {
            texts: [slot.theme],
            hints: [...keywords, copy.headline, copy.subheadline],
            now,
            excludeIds,
            preferPortrait,
          })[0];
          const decision = decidePhotoSource({
            bestBankScore: best?.score ?? null,
            geminiAvailable: geminiAvailable(),
            recentSources,
            geminiShare: geminiShare,
          });

          const useBank = async (reason: string) => {
            if (!best) return false;
            photoUrl = best.asset.url;
            bankScore = best.score;
            await ctx.db.markMediaAssetUsed(best.asset.id);
            photoMeta = { photoSource: "bank", photoAssetId: best.asset.id };
            photoReason = `${reason} (score ${best.score.toFixed(2)}: ${best.matched.join(", ") || "rotación"})`;
            return true;
          };

          if (decision === "bank") {
            await useBank("Foto del banco");
          } else if (decision === "gemini") {
            const ephemerisHint = accentEphemeris
              ? `Usa colores rojo y blanco (${accentEphemeris.name}), estilo patrio peruano.`
              : undefined;
            photoUrl = await generateAndUpload(
              buildPostImagePrompt({
                rubro,
                theme: slot.theme,
                headline: copy.headline,
                keywords,
                ephemerisHint,
                artDirection,
              }),
              "",
            );
            if (photoUrl) {
              photoMeta = { photoSource: "gemini" };
              photoReason =
                best && best.score < BANK_WEAK_MATCH
                  ? `Gemini: sin foto relevante en el banco (mejor score ${best.score.toFixed(2)})`
                  : "Gemini: reparto banco/IA";
            } else if (best && best.score >= BANK_WEAK_MATCH) {
              await useBank("Foto del banco porque Gemini falló");
            } else {
              photoReason = "Degradado: Gemini falló y el banco no tiene nada relacionado";
            }
          } else {
            photoReason = "Degradado: banco vacío y sin Gemini";
          }
        }
      }

      const brief = buildBriefForComponentRef(
        template.component_ref,
        copy,
        photoUrl,
        colorOverride,
        carouselPhotoUrls,
        photoMeta,
      );

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
        decision: {
          creative_id: creative.id,
          template: templateName,
          photo_source: photoMeta.photoSource,
          ...(photoMeta.photoAssetId ? { photo_asset_id: photoMeta.photoAssetId } : {}),
          ...(bankScore !== undefined ? { bank_score: Number(bankScore.toFixed(3)) } : {}),
          gemini_calls: geminiUsedThisRun,
        },
        rationale: `Copy generado por el LLM local a partir de productos/promociones activos. ${photoReason}.`,
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
        //
        // social_paused skips ONLY this auto-approve-and-publish step, not
        // the render above: a tenant can have its blog article (which reads
        // this same rendered creative) keep going out while its social feed
        // stays quiet — see the article agent, which runs off this same
        // creative.generated event independent of hitl_mode.
        if (tenant.hitl_mode === "full-auto" && !tenant.social_paused) {
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
