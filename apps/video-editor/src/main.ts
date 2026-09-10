// Entry point for the background service (launchd, matching apps/workers
// and apps/render-templates — see the Fase 0 decision to run this as its
// own local process rather than folding it into apps/workers). Consumes
// the SAME outbox/dispatcher infrastructure apps/workers already runs
// (see queue.ts) — a job here is one claimed `events` row, same shape as
// apps/workers/src/main.ts's own job handlers.

import type { Job } from "bullmq";
import type { Database } from "@pulso/db/types";
import { createLogger } from "@pulso/shared/logger";
import { startVideoEditorWorker, closeVideoEditorWorker } from "./queue.js";
import { processProjectJob, renderVideoJob } from "./db-pipeline.js";

const logger = createLogger({ agent: "video-editor-main" });

type EventRow = Database["public"]["Tables"]["events"]["Row"];

async function processJob(job: Job<EventRow>): Promise<void> {
  const event = job.data;

  switch (event.type) {
    case "video.project.requested": {
      const payload = event.payload as { projectId: string };
      await processProjectJob({ projectId: payload.projectId, tenantId: event.tenant_id });
      return;
    }
    case "video.render.requested": {
      const payload = event.payload as { projectId: string; videoId: string };
      await renderVideoJob({ projectId: payload.projectId, tenantId: event.tenant_id, videoId: payload.videoId });
      return;
    }
    default:
      logger.warn({ eventType: event.type }, "video-editor worker received unhandled event type");
  }
}

const worker = startVideoEditorWorker(processJob);
logger.info("video-editor worker bootstrapped");

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down video-editor worker");
  await closeVideoEditorWorker(worker);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
