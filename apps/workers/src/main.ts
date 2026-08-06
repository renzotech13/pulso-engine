import { Worker, type Job } from "bullmq";
import { loadConfig } from "@pulso/shared/config";
import { createLogger } from "@pulso/shared/logger";
import type { Database } from "@pulso/db/types";
import { startDispatcher } from "./dispatcher.js";
import { getQueue, getRedisConnection, closeAllQueues } from "./queues.js";
import { runOrchestratorTick } from "./agents/orchestrator.js";
import { runHelloAgent } from "./agents/hello.js";
import { runPlannerForTenant, runPlannerTick } from "./agents/planner.js";
import { runCreativeAgentForSlot } from "./agents/creative.js";
import { runPublishAgentForCreative } from "@pulso/publish/agent";
import { runPublishTick } from "./agents/publish-tick.js";
import { runNewsAgentForTenant, runNewsTick } from "./agents/news.js";

loadConfig(); // fail fast at boot if env vars are missing/invalid

const logger = createLogger({ agent: "workers-main" });

type EventRow = Database["public"]["Tables"]["events"]["Row"];

async function processCoreJob(job: Job): Promise<void> {
  if (job.name === "orchestrator.tick") {
    await runOrchestratorTick();
    return;
  }
  if (job.name === "planner.tick") {
    await runPlannerTick();
    return;
  }
  if (job.name === "publish.tick") {
    await runPublishTick();
    return;
  }
  if (job.name === "news.tick") {
    await runNewsTick();
    return;
  }

  const event = job.data as EventRow;

  switch (event.type) {
    case "agent.heartbeat.requested":
      await runHelloAgent(event.tenant_id, event.correlation_id, event.payload as { reason: string });
      return;
    case "agent.heartbeat.completed":
      logger.info(
        { tenantId: event.tenant_id, correlationId: event.correlation_id },
        "heartbeat cycle closed",
      );
      return;
    case "calendar.plan.requested":
      await runPlannerForTenant(event.tenant_id, event.type, event.correlation_id, job.id);
      return;
    case "calendar.slots.proposed":
      logger.info(
        { tenantId: event.tenant_id, correlationId: event.correlation_id },
        "calendar slots proposed",
      );
      return;
    case "news.digest.requested":
      await runNewsAgentForTenant(event.tenant_id, event.correlation_id, job.id);
      return;
    case "news.suggestions.generated":
      logger.info(
        { tenantId: event.tenant_id, correlationId: event.correlation_id },
        "news suggestions generated",
      );
      return;
    default:
      logger.warn({ eventType: event.type }, "core worker received unhandled event type");
  }
}

async function processRenderJob(job: Job): Promise<void> {
  const event = job.data as EventRow;

  switch (event.type) {
    case "creative.requested": {
      const payload = event.payload as { calendarSlotId: string };
      await runCreativeAgentForSlot(event.tenant_id, payload.calendarSlotId, event.correlation_id, job.id);
      return;
    }
    case "creative.generated":
      logger.info(
        { tenantId: event.tenant_id, correlationId: event.correlation_id },
        "creative generated",
      );
      return;
    default:
      logger.warn({ eventType: event.type }, "render worker received unhandled event type");
  }
}

async function processPublishJob(job: Job): Promise<void> {
  const event = job.data as EventRow;

  switch (event.type) {
    case "publish.requested": {
      const payload = event.payload as { creativeId: string };
      await runPublishAgentForCreative(event.tenant_id, payload.creativeId, event.correlation_id);
      return;
    }
    case "publish.completed":
      logger.info(
        { tenantId: event.tenant_id, correlationId: event.correlation_id },
        "publish completed",
      );
      return;
    default:
      logger.warn({ eventType: event.type }, "publish worker received unhandled event type");
  }
}

async function main(): Promise<void> {
  const stopDispatcher = startDispatcher();

  const coreWorker = new Worker("core", processCoreJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });
  coreWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "core job failed");
  });

  const renderWorker = new Worker("render", processRenderJob, {
    connection: getRedisConnection(),
    concurrency: 2,
  });
  renderWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "render job failed");
  });

  const publishWorker = new Worker("publish", processPublishJob, {
    connection: getRedisConnection(),
    concurrency: 2,
  });
  publishWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "publish job failed");
  });

  const coreQueue = getQueue("core");
  await coreQueue.add(
    "orchestrator.tick",
    {},
    { repeat: { every: 60_000 }, jobId: "orchestrator-tick" },
  );
  // Real "Planner: diario" cadence — to see it run without waiting 24h, use
  // the dashboard's "Regenerar" button (or call the RPC directly), which
  // fires the exact same calendar.plan.requested path.
  await coreQueue.add(
    "planner.tick",
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: "planner-tick" },
  );
  // Only fires publish.requested for full-auto tenants (see publish-tick.ts)
  // — everyone else still needs a manual "Publicar" click, unaffected by this.
  await coreQueue.add(
    "publish.tick",
    {},
    { repeat: { every: 60 * 60 * 1000 }, jobId: "publish-tick" },
  );
  // Always lands as 'pending' news_suggestions regardless of hitl_mode — see
  // news.ts. To see it run without waiting 24h, call runNewsAgentForTenant
  // directly for one tenant, same as the Planner's own dev-loop note above.
  await coreQueue.add(
    "news.tick",
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: "news-tick" },
  );

  logger.info(
    "workers bootstrapped: dispatcher + core/render/publish workers + orchestrator/planner/publish/news ticks running",
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down workers");
    stopDispatcher();
    await coreWorker.close();
    await renderWorker.close();
    await publishWorker.close();
    await closeAllQueues();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  logger.error({ err }, "workers failed to bootstrap");
  process.exit(1);
});
