import { createServiceRoleClient } from "@pulso/db/worker";
import { publishEvent } from "@pulso/events/publish";
import { loadConfig } from "@pulso/shared/config";
import { newCorrelationId } from "@pulso/shared/ids";
import { createLogger } from "@pulso/shared/logger";
import { limaDatePlusDays, limaToday } from "@pulso/shared/time";

const logger = createLogger({ agent: "render-tick" });

/**
 * How far ahead an approved slot with no creative gets one requested. Short
 * on purpose: a creative fires an eager publish, and for a future date that
 * means a Facebook post scheduled with Meta right away — regenerating the
 * piece later does NOT cancel that, so pieces are better generated close to
 * their date than a month out.
 */
const CREATIVE_LOOKAHEAD_DAYS = 2;
/** Bounds retries on a slot whose copy keeps getting rejected (see creative.ts). */
const MAX_CREATIVE_REQUESTS_PER_DAY = 3;
/** A request already in flight (LLM + render can take minutes) is not re-fired. */
const CREATIVE_REQUEST_COOLDOWN_MS = 30 * 60 * 1000;

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
/**
 * Approved slots that never got a creative. Two real ways to land here: a
 * human (or a script) approved slots directly in the database, so the
 * Planner's insert-time `creative.requested` never fired; or the Creative
 * agent gave up on the copy (creative.ts skips instead of throwing) and the
 * slot was left as approved-but-empty. Either way nothing else would ever
 * pick it up — the calendar just says "generando…" until someone notices.
 */
async function requestMissingCreatives(service: ReturnType<typeof createServiceRoleClient>): Promise<number> {
  const today = limaToday();
  const { data: slots, error } = await service
    .from("content_calendar")
    .select("id, tenant_id, date")
    .eq("status", "approved")
    .is("creative_id", null)
    .eq("hold_publish", false)
    .gte("date", today)
    .lte("date", limaDatePlusDays(today, CREATIVE_LOOKAHEAD_DAYS))
    .order("date", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    logger.error({ err: error }, "failed to list approved slots without a creative");
    return 0;
  }

  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  let requested = 0;

  for (const slot of slots ?? []) {
    const { data: recent } = await service
      .from("events")
      .select("created_at")
      .eq("tenant_id", slot.tenant_id)
      .eq("type", "creative.requested")
      .eq("payload->>calendarSlotId", slot.id)
      .gte("created_at", dayAgo);

    const attemptsToday = recent?.length ?? 0;
    if (attemptsToday >= MAX_CREATIVE_REQUESTS_PER_DAY) continue;
    const inFlight = (recent ?? []).some(
      (e) => Date.parse(e.created_at) > now - CREATIVE_REQUEST_COOLDOWN_MS,
    );
    if (inFlight) continue;

    await publishEvent(service, {
      tenantId: slot.tenant_id,
      type: "creative.requested",
      payload: { calendarSlotId: slot.id },
      correlationId: newCorrelationId(),
    });
    requested++;
  }

  return requested;
}

export async function runRenderTick(): Promise<void> {
  const config = loadConfig();
  const service = createServiceRoleClient();

  const requestedCount = await requestMissingCreatives(service);
  if (requestedCount > 0) {
    logger.info({ requestedCount }, "requested creatives for approved slots that had none");
  }

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
