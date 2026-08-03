import { createServiceRoleClient, createTenantScopedClient } from "@pulso/db/worker";
import { publishEvent } from "@pulso/events/publish";
import { newCorrelationId } from "@pulso/shared/ids";
import { createLogger } from "@pulso/shared/logger";

const logger = createLogger({ agent: "publish-tick" });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Only tenants in `hitl_mode = 'full-auto'` get here — approve-all and
 * approve-creatives both still require a human to click "Publicar", same as
 * today. For each such tenant, fires `publish.requested` for every slot
 * whose date has arrived (or passed, catching up on stragglers), has an
 * already-approved creative, and hasn't been published before under *any*
 * creative (`content_calendar.published_at`, not a per-creative check —
 * regenerating a creative deletes it and its publications history, so that
 * history can't be trusted to remember a previous creative already went
 * out for this same day). Fires the exact same event a manual click
 * produces, so `runPublishAgentForCreative` needs no changes.
 */
export async function runPublishTick(): Promise<void> {
  const service = createServiceRoleClient();
  const { data: tenants, error } = await service
    .from("tenants")
    .select("id")
    .eq("status", "active")
    .eq("hitl_mode", "full-auto");

  if (error) {
    logger.error({ err: error }, "failed to list full-auto tenants");
    return;
  }

  const todayStr = today();
  let firedCount = 0;

  for (const tenant of tenants ?? []) {
    const db = createTenantScopedClient(tenant.id, service);
    const candidates = await db.listAutoPublishCandidates(todayStr);

    for (const candidate of candidates) {
      await publishEvent(service, {
        tenantId: tenant.id,
        type: "publish.requested",
        payload: { creativeId: candidate.creativeId },
        correlationId: newCorrelationId(),
      });
      firedCount++;
    }
  }

  logger.info({ tenantCount: tenants?.length ?? 0, firedCount }, "publish tick complete");
}
