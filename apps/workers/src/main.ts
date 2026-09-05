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
import { runRenderTick } from "./agents/render-tick.js";
import { runNewsAgentForTenant, runNewsTick } from "./agents/news.js";
import { fillNewsSlotForTenant } from "./agents/news-slot.js";
import { runMediaTagTick } from "./agents/media-tag-tick.js";

loadConfig(); // fail fast at boot if env vars are missing/invalid

// Every schedule in here is a business hour in Peru, not a UTC one.
const LIMA_TZ = "America/Lima";

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
  if (job.name === "render.tick") {
    await runRenderTick();
    return;
  }
  if (job.name === "news.tick") {
    await runNewsTick();
    return;
  }
  if (job.name === "media-tag.tick") {
    await runMediaTagTick();
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
      // The digest just ran; now one suggestion gets picked for the day's
      // news slot. Chained to the event rather than given its own tick so
      // the ordering between the two is deterministic (see news-slot.ts).
      await fillNewsSlotForTenant(event.tenant_id, event.correlation_id);
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

  // The interval-based repeatables the cron schedulers below replace live
  // under their own keys; without this they would keep firing alongside the
  // new ones after a deploy. Matched on `every` being set, so this only ever
  // sees the old interval entries and never the cron schedulers themselves.
  const CRON_TICK_NAMES = new Set(["planner.tick", "news.tick", "publish.tick"]);
  for (const legacy of await coreQueue.getRepeatableJobs()) {
    if (legacy.every && CRON_TICK_NAMES.has(legacy.name)) {
      await coreQueue.removeRepeatableByKey(legacy.key);
      logger.info({ name: legacy.name, key: legacy.key }, "removed legacy interval tick");
    }
  }
  await coreQueue.add(
    "orchestrator.tick",
    {},
    { repeat: { every: 60_000 }, jobId: "orchestrator-tick" },
  );
  // The daily agents run on a Lima-time clock rather than `every: 24h`,
  // which fired 24 hours after whenever the workers last happened to boot.
  // That was fine while a slot published as soon as its date arrived, but
  // slots now have hours: the news digest has to have run BEFORE the day's
  // news slot is due (see news-slot.ts), and a digest whose time of day
  // drifts with the last restart can't promise that.
  //
  // Mid-morning, not dawn: these workers run on a laptop that sleeps
  // overnight, and a 05:00 cron simply never fired the first day it was
  // tried (the 06:00 one only ran because the machine happened to wake in
  // time to catch up). The Planner plans 30 days ahead so its hour is
  // irrelevant as long as it runs; the digest only has to precede the
  // afternoon news slot.
  await coreQueue.upsertJobScheduler(
    "planner-tick",
    { pattern: "0 10 * * *", tz: LIMA_TZ },
    { name: "planner.tick" },
  );
  // Only fires publish.requested for full-auto tenants (see publish-tick.ts)
  // — everyone else still needs a manual "Publicar" click, unaffected by this.
  // On the hour, not every 60 minutes from boot, so a slot due at 09:00 goes
  // out at 09:00-ish instead of at whatever minute the workers came up.
  await coreQueue.upsertJobScheduler(
    "publish-tick",
    { pattern: "0 * * * *", tz: LIMA_TZ },
    { name: "publish.tick" },
  );
  // Retries creatives whose render never completed (see render-tick.ts) —
  // this is what keeps a piece from sitting at "generando…" forever after a
  // transient render failure, without anyone having to click "Regenerar".
  await coreQueue.add(
    "render.tick",
    {},
    { repeat: { every: 5 * 60 * 1000 }, jobId: "render-tick" },
  );
  // Describes newly uploaded bank photos with Gemini vision, five at a time
  // (see media-tag-tick.ts) — what lets the Creative pick a photo by theme.
  await coreQueue.add(
    "media-tag.tick",
    {},
    { repeat: { every: 10 * 60 * 1000 }, jobId: "media-tag-tick" },
  );
  // Always lands as 'pending' news_suggestions regardless of hitl_mode — see
  // news.ts. To see it run without waiting for tomorrow, call
  // runNewsAgentForTenant directly for one tenant, same as the Planner's own
  // dev-loop note above.
  await coreQueue.upsertJobScheduler(
    "news-tick",
    { pattern: "30 10 * * *", tz: LIMA_TZ },
    { name: "news.tick" },
  );

  logger.info(
    "workers bootstrapped: dispatcher + core/render/publish workers + orchestrator/planner/publish/render/news ticks running",
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
