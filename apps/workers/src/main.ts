import { Worker, type Job } from "bullmq";
import { loadConfig } from "@pulso/shared/config";
import { createLogger } from "@pulso/shared/logger";
import type { Database } from "@pulso/db/types";
import { startDispatcher } from "./dispatcher.js";
import { getQueue, getRedisConnection, closeAllQueues } from "./queues.js";
import { runOrchestratorTick } from "./agents/orchestrator.js";
import { runHelloAgent } from "./agents/hello.js";
import { runPlannerForTenant, runPlannerTick } from "./agents/planner.js";

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
    default:
      logger.warn({ eventType: event.type }, "core worker received unhandled event type");
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

  logger.info("workers bootstrapped: dispatcher + core worker + orchestrator/planner ticks running");

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down workers");
    stopDispatcher();
    await coreWorker.close();
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
