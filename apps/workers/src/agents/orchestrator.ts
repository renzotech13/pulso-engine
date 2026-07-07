import { createServiceRoleClient } from "@pulso/db/worker";
import { publishEvent } from "@pulso/events/publish";
import { newCorrelationId } from "@pulso/shared/ids";
import { createLogger } from "@pulso/shared/logger";

const logger = createLogger({ agent: "orchestrator" });

/**
 * Fase 0 stand-in for the real orchestrator loop (Fase 5): fans a heartbeat
 * request out to every active tenant on each repeatable-job tick, purely to
 * prove events flow end to end. Replaced once the Planner/Ads/Analytics
 * agents exist and the orchestrator has real priorities to resolve.
 */
export async function runOrchestratorTick(): Promise<void> {
  const service = createServiceRoleClient();
  const { data: tenants, error } = await service
    .from("tenants")
    .select("id")
    .eq("status", "active");

  if (error) {
    logger.error({ err: error }, "failed to list active tenants");
    return;
  }

  for (const tenant of tenants ?? []) {
    await publishEvent(service, {
      tenantId: tenant.id,
      type: "agent.heartbeat.requested",
      payload: { reason: "orchestrator.tick" },
      correlationId: newCorrelationId(),
    });
  }

  logger.info({ tenantCount: tenants?.length ?? 0 }, "orchestrator tick complete");
}
