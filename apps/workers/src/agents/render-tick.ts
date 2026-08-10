import { createServiceRoleClient } from "@pulso/db/worker";
import { publishEvent } from "@pulso/events/publish";
import { loadConfig } from "@pulso/shared/config";
import { newCorrelationId } from "@pulso/shared/ids";
import { createLogger } from "@pulso/shared/logger";

const logger = createLogger({ agent: "render-tick" });

/**
 * A creative is only picked up once it has been sitting untouched this long,
 * so an eager render still in flight (creative.ts fires one right after
 * generating) isn't raced and re-fired underneath itself.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Nothing older than this is retried. Without a per-row attempt counter this
 * is what bounds retries on a genuinely broken piece (bad brief, missing
 * template) to a finite number instead of hammering the render service
 * forever — a human has to regenerate or delete it after that.
 */
const MAX_AGE_HOURS = 24;

/** Keeps one tick's worth of Puppeteer/Remotion work bounded on a laptop. */
const BATCH_LIMIT = 5;

/**
 * Self-heals creatives whose render never completed. The render itself is
 * lazy-by-design (see the render route) and creative.ts only fires one eager
 * attempt — so any transient failure at that exact moment (render service
 * restarting, a redeploy, the dev server recompiling) left the piece stuck at
 * 'pending'/'failed' forever, with the only recovery being a human clicking
 * "Regenerar". This retries them on a schedule instead.
 *
 * Renders for every tenant regardless of hitl_mode — a rendered piece is
 * strictly more useful than an unrendered one, whoever reviews it. But only
 * full-auto tenants get the approve + publish.requested follow-through
 * (mirroring creative.ts), so the human review gate is preserved everywhere
 * else.
 */
export async function runRenderTick(): Promise<void> {
  const config = loadConfig();
  const service = createServiceRoleClient();

  const now = Date.now();
  const staleBefore = new Date(now - STALE_AFTER_MS).toISOString();
  const oldestAllowed = new Date(now - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: stuck, error } = await service
    .from("creatives")
    .select("id, tenant_id, type, status")
    .in("status", ["pending", "failed"])
    .lt("updated_at", staleBefore)
    .gt("created_at", oldestAllowed)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    logger.error({ err: error }, "failed to list stuck creatives");
    return;
  }
  if (!stuck?.length) return;

  const { data: autoTenants } = await service
    .from("tenants")
    .select("id")
    .eq("status", "active")
    .eq("hitl_mode", "full-auto");
  const fullAutoIds = new Set((autoTenants ?? []).map((t) => t.id));

  let recoveredCount = 0;

  for (const creative of stuck) {
    const extension = creative.type === "video" ? "mp4" : "png";
    const correlationId = newCorrelationId();

    try {
      await fetch(`${config.RENDER_TEMPLATES_URL}/api/render/${creative.id}.${extension}`);
    } catch (err) {
      logger.warn(
        { creativeId: creative.id, err: err instanceof Error ? err.message : String(err) },
        "retry render request failed",
      );
      continue;
    }

    // The render route is what flips status to 'ready' (or back to 'failed'),
    // so re-read rather than assuming the fetch above succeeded.
    const { data: rendered } = await service
      .from("creatives")
      .select("status")
      .eq("id", creative.id)
      .maybeSingle();

    if (rendered?.status !== "ready") continue;
    recoveredCount++;

    if (!fullAutoIds.has(creative.tenant_id)) continue;

    await service.from("creatives").update({ status: "approved" }).eq("id", creative.id);
    await publishEvent(service, {
      tenantId: creative.tenant_id,
      type: "publish.requested",
      payload: { creativeId: creative.id },
      correlationId,
    });
  }

  logger.info({ stuckCount: stuck.length, recoveredCount }, "render tick complete");
}
