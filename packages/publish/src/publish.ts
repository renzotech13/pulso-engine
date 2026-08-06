import { publishEvent } from "@pulso/events/publish";
import { createServiceRoleClient } from "@pulso/db/worker";
import type { Json } from "@pulso/db/types";
// Self-referencing package-subpath imports (not relative "./x.js" paths) —
// those go through the same package.json `exports` resolution any external
// consumer uses, which Next's webpack (with transpilePackages set) handles
// correctly. A plain relative import pointing a NodeNext-style ".js"
// extension at an unbuilt ".ts" file does not (confirmed the hard way on
// @pulso/shared/image-gen — see apps/web/next.config.ts).
import { executeAgentRun } from "@pulso/publish/base-agent";
import { buildCaption } from "@pulso/publish/caption";

const META_GRAPH_API_VERSION = "v21.0";
const IG_CONTAINER_POLL_ATTEMPTS = 10;
const IG_CONTAINER_POLL_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 9am Peru time (UTC-5, no DST) on the slot's date, as Unix seconds — Meta's
 * scheduled_publish_time wants a specific moment, and content_calendar only
 * has a date, so this is the one fixed posting time every scheduled post uses.
 */
function computeScheduledPublishTime(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T09:00:00-05:00`).getTime() / 1000);
}

interface GraphResponse {
  id?: string;
  post_id?: string;
  status_code?: string;
  error?: { message: string };
}

async function graphGet(path: string, params: Record<string, string>): Promise<GraphResponse> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url.toString());
  const data = (await response.json()) as GraphResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? `graph api error on GET ${path}`);
  }
  return data;
}

async function graphPost(path: string, params: Record<string, string>): Promise<GraphResponse> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = (await response.json()) as GraphResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? `graph api error on POST ${path}`);
  }
  return data;
}

/**
 * `scheduledPublishTime`, when given, makes this a real Meta-side scheduled
 * post (`published=false` + `scheduled_publish_time`) instead of publishing
 * immediately — Meta holds and fires it itself, and it shows up in Meta
 * Business Suite's Planner right away. Facebook-only: Instagram's Content
 * Publishing API has no equivalent parameter (confirmed against the official
 * reference — /media and /media_publish take no schedule field at all).
 */
async function publishToFacebook(
  pageId: string,
  accessToken: string,
  assetUrl: string,
  isVideo: boolean,
  caption: string,
  scheduledPublishTime?: number,
): Promise<string> {
  const scheduleParams = scheduledPublishTime
    ? { published: "false", scheduled_publish_time: String(scheduledPublishTime) }
    : {};

  if (isVideo) {
    const data = await graphPost(`${pageId}/videos`, {
      file_url: assetUrl,
      description: caption,
      access_token: accessToken,
      ...scheduleParams,
    });
    return data.id ?? "";
  }

  const data = await graphPost(`${pageId}/photos`, {
    url: assetUrl,
    caption,
    access_token: accessToken,
    ...scheduleParams,
  });
  return data.post_id ?? data.id ?? "";
}

/**
 * Instagram's media container is created async — for video especially, Meta
 * needs time to ingest the file before it can be published. Poll status_code
 * until FINISHED (or ERROR) instead of publishing immediately. Shared by the
 * single-asset and carousel publish paths — a carousel's parent container is
 * just as async as a single video/image one.
 */
async function pollContainerUntilFinished(creationId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < IG_CONTAINER_POLL_ATTEMPTS; attempt++) {
    const status = await graphGet(creationId, { fields: "status_code", access_token: accessToken });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") {
      throw new Error("Instagram falló al procesar el contenedor de medios");
    }
    await sleep(IG_CONTAINER_POLL_DELAY_MS);
  }
}

async function publishToInstagram(
  igUserId: string,
  accessToken: string,
  assetUrl: string,
  isVideo: boolean,
  caption: string,
): Promise<string> {
  const containerParams: Record<string, string> = isVideo
    ? { video_url: assetUrl, caption, media_type: "REELS", access_token: accessToken }
    : { image_url: assetUrl, caption, access_token: accessToken };

  const container = await graphPost(`${igUserId}/media`, containerParams);
  const creationId = container.id ?? "";

  await pollContainerUntilFinished(creationId, accessToken);

  const published = await graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });
  return published.id ?? "";
}

/**
 * Facebook multi-photo post: each image is uploaded unpublished to /photos
 * (published=false — it's just registered, not posted on its own), then one
 * /feed call attaches all of them via attached_media[i]. This renders as a
 * grid/album post, not a swipeable carousel — Facebook has no swipeable
 * carousel format for organic Page posts via this API, only Instagram does.
 * scheduledPublishTime, when given, applies to the /feed call only (same
 * published=false + scheduled_publish_time as the single-asset path) — the
 * per-photo uploads are always unpublished regardless, that's just how the
 * album gets assembled.
 */
async function publishCarouselToFacebook(
  pageId: string,
  accessToken: string,
  assetUrls: string[],
  caption: string,
  scheduledPublishTime?: number,
): Promise<string> {
  const photoIds: string[] = [];
  for (const url of assetUrls) {
    const photo = await graphPost(`${pageId}/photos`, {
      url,
      published: "false",
      access_token: accessToken,
    });
    photoIds.push(photo.id ?? "");
  }

  const attachedMedia = Object.fromEntries(
    photoIds.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]),
  );

  const scheduleParams = scheduledPublishTime
    ? { published: "false", scheduled_publish_time: String(scheduledPublishTime) }
    : {};

  const data = await graphPost(`${pageId}/feed`, {
    message: caption,
    access_token: accessToken,
    ...attachedMedia,
    ...scheduleParams,
  });
  return data.post_id ?? data.id ?? "";
}

/**
 * Instagram carousel: one is_carousel_item container per image, then a
 * parent container (media_type: CAROUSEL, children: the item ids) that
 * itself gets polled and published — the caption lives on the parent only,
 * never on the item containers. No native scheduling here either, same
 * limitation as a single post.
 */
async function publishCarouselToInstagram(
  igUserId: string,
  accessToken: string,
  assetUrls: string[],
  caption: string,
): Promise<string> {
  const childIds: string[] = [];
  for (const url of assetUrls) {
    const item = await graphPost(`${igUserId}/media`, {
      image_url: url,
      is_carousel_item: "true",
      access_token: accessToken,
    });
    childIds.push(item.id ?? "");
  }

  const parent = await graphPost(`${igUserId}/media`, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
    access_token: accessToken,
  });
  const creationId = parent.id ?? "";

  await pollContainerUntilFinished(creationId, accessToken);

  const published = await graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });
  return published.id ?? "";
}

/**
 * Posts an approved creative to every platform the tenant has connected.
 * Idempotent per platform: if a creative was already published successfully
 * to a given platform, that platform is skipped — a duplicate
 * `publish.requested` (double click, retried job) never double-posts.
 * Each platform's outcome is independent — Facebook succeeding doesn't
 * block recording an Instagram failure, and vice versa.
 */
export async function runPublishAgentForCreative(
  tenantId: string,
  creativeId: string,
  correlationId: string,
): Promise<void> {
  await executeAgentRun(
    { agent: "publish", tenantId, trigger: "publish.requested", correlationId },
    async (ctx) => {
      const skip = async (rationale: string, observed: Json) => {
        await ctx.db.insertDecisionLog({
          agent: "publish",
          observed,
          decision: { action: "skip" },
          rationale,
          correlation_id: correlationId,
        });
      };

      const creative = await ctx.db.getCreativeById(creativeId);
      if (!creative || creative.asset_urls.length === 0) {
        await skip("El creative no existe o no tiene un asset renderizado.", { creative_id: creativeId });
        return;
      }

      // Guards against the same calendar day going out twice for real: a
      // regenerated creative is a brand-new row (its own fresh `publications`
      // history), so the per-platform check further down can't see that this
      // SLOT already published under a previous creative that's since been
      // deleted. published_at lives on content_calendar specifically because
      // it's the one thing that survives a regenerate.
      const slot = creative.calendar_slot_id
        ? await ctx.db.getContentCalendarSlotById(creative.calendar_slot_id)
        : null;
      if (slot?.published_at) {
        await skip("Este día del calendario ya se publicó antes (con un creative distinto).", {
          creative_id: creativeId,
          calendar_slot_id: creative.calendar_slot_id,
          published_at: slot.published_at,
        });
        return;
      }

      const connection = await ctx.db.getSocialConnection();
      if (!connection || connection.status !== "active") {
        await skip("No hay una conexión de Meta activa para este tenant.", { creative_id: creativeId });
        return;
      }

      const assetUrl = creative.asset_urls[0]!;
      const isVideo = creative.type === "video";
      const isCarousel = creative.type === "carousel";
      const caption = buildCaption(creative.brief as Record<string, unknown>);

      // A future-dated slot means "schedule what Meta lets us schedule, wait
      // on the rest" — Facebook can be handed to Meta right now (real
      // scheduled_publish_time, shows up in Business Suite today); Instagram
      // has no such mechanism for third-party apps, so it's left untouched
      // and picked up for real when the tick notices the date has arrived
      // (published_at is still null, so listAutoPublishCandidates finds it).
      const todayStr = new Date().toISOString().slice(0, 10);
      const isFutureDate = Boolean(slot && slot.date > todayStr);
      const scheduledPublishTime = isFutureDate ? computeScheduledPublishTime(slot!.date) : undefined;

      const platforms: Array<"facebook" | "instagram"> = ["facebook"];
      if (connection.instagram_business_account_id) platforms.push("instagram");

      const results: Record<string, string> = {};

      for (const platform of platforms) {
        if (isFutureDate && platform === "instagram") continue;

        const existing = await ctx.db.getHandledPublication(creativeId, platform);
        if (existing) {
          results[platform] = existing.status === "scheduled" ? "already scheduled" : "already published";
          continue;
        }

        const schedulingThisOne = isFutureDate && platform === "facebook";

        const publication = await ctx.db.insertPublication({
          creative_id: creativeId,
          platform,
          status: "pending",
        });

        try {
          const externalPostId = isCarousel
            ? platform === "facebook"
              ? await publishCarouselToFacebook(
                  connection.page_id,
                  connection.access_token,
                  creative.asset_urls,
                  caption,
                  scheduledPublishTime,
                )
              : await publishCarouselToInstagram(
                  connection.instagram_business_account_id!,
                  connection.access_token,
                  creative.asset_urls,
                  caption,
                )
            : platform === "facebook"
              ? await publishToFacebook(
                  connection.page_id,
                  connection.access_token,
                  assetUrl,
                  isVideo,
                  caption,
                  scheduledPublishTime,
                )
              : await publishToInstagram(
                  connection.instagram_business_account_id!,
                  connection.access_token,
                  assetUrl,
                  isVideo,
                  caption,
                );

          await ctx.db.updatePublication(publication.id, schedulingThisOne
            ? { status: "scheduled", external_post_id: externalPostId }
            : { status: "published", external_post_id: externalPostId, published_at: new Date().toISOString() },
          );
          results[platform] = schedulingThisOne ? "scheduled" : "published";
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await ctx.db.updatePublication(publication.id, { status: "failed", error_message: message });
          results[platform] = `failed: ${message}`;
        }
      }

      // Never marks the slot done from the scheduling pass — Instagram still
      // hasn't actually happened, so the day-of tick run needs to see this
      // slot again (published_at still null) to finish the job for real.
      const anyPublished = Object.values(results).some(
        (r) => r === "published" || r === "already published",
      );
      if (!isFutureDate && anyPublished && creative.calendar_slot_id) {
        await ctx.db.markCalendarSlotPublished(creative.calendar_slot_id);
      }

      await ctx.db.insertDecisionLog({
        agent: "publish",
        observed: { creative_id: creativeId, platforms },
        decision: results,
        rationale: "Resultado de publicar en cada plataforma conectada.",
        correlation_id: correlationId,
      });

      const service = createServiceRoleClient();
      await publishEvent(service, { tenantId, type: "publish.completed", payload: { creativeId }, correlationId });
    },
  );
}
