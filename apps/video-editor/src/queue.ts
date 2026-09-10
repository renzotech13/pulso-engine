// Own BullMQ WORKER, not its own dispatcher — Fase 0 decided this runs as
// its own local process (like render-templates), isolated so a heavy video
// render can't starve the day-to-day social content pipeline's
// concurrency. But the outbox→BullMQ routing itself stays centralized in
// apps/workers/src/dispatcher.ts, which already generically routes ANY
// event to whatever queue its catalog entry names (see
// packages/events/src/catalog.ts's "video-editor" entries) — running a
// SECOND poller against the same `events` table here would just be
// redundant. This file only ever consumes; it never calls queue.add()
// itself, unlike apps/workers/src/queues.ts.
//
// Reads REDIS_URL directly instead of @pulso/shared's loadConfig(), which
// validates the full worker env schema (LMSTUDIO_MODEL, GEMINI_API_KEY...)
// this service has no reason to require — same reasoning as
// @pulso/db/worker.ts's createServiceRoleClient.

import { Worker, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { ConfigError } from "@pulso/shared/errors";
import { createLogger } from "@pulso/shared/logger";

const logger = createLogger({ agent: "video-editor-queue" });

export const VIDEO_EDITOR_QUEUE = "video-editor";

let connection: Redis | undefined;

export function getRedisConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new ConfigError("REDIS_URL must be set");
    connection = new Redis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function startVideoEditorWorker<T>(processor: Processor<T>): Worker<T> {
  // Concurrency 1 on purpose: a render is CPU/GPU-heavy (Chromium + ffmpeg
  // encoding) — running more than one at a time on the same machine would
  // just make both slower, not finish sooner.
  const worker = new Worker<T>(VIDEO_EDITOR_QUEUE, processor, {
    connection: getRedisConnection(),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "video-editor job failed");
  });
  return worker;
}

export async function closeVideoEditorWorker(worker: Worker): Promise<void> {
  await worker.close();
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}
