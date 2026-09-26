// DB-backed twin of bg-replace-cli.ts: same replaceBackgroundSplit, but the
// two inputs come from Storage (uploaded by the dashboard's
// /video-editor/fondo form) and the result goes back up to the output
// bucket instead of a local path. Independent of video_projects on purpose —
// see migration 35 for why this is its own tool.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServiceRoleClient, createTenantScopedClient } from "@pulso/db/worker";
import { createLogger } from "@pulso/shared/logger";
import { replaceBackgroundSplit } from "./pipeline/background-replace.js";
import { ASSETS_BUCKET, OUTPUT_BUCKET, deleteFiles, downloadToFile, uploadFile } from "./storage.js";

export interface BgReplaceJobData {
  jobId: string;
  tenantId: string;
}

const logger = createLogger({ agent: "video-editor-bg-replace" });

// Same defaults bg-replace-cli.ts uses — the dashboard only exposes the
// cut and blend band, the two that actually change how the shot reads.
const WORK_WIDTH = 1080;
const OUTPUT_FPS = 30;

/** Writing progress on every frame would be one DB round-trip per frame — every few percent is plenty for a 3s poll. */
const PROGRESS_STEP = 5;

export async function bgReplaceJob({ jobId, tenantId }: BgReplaceJobData): Promise<void> {
  const service = createServiceRoleClient();
  const db = createTenantScopedClient(tenantId, service);

  const job = await db.getVideoBgReplaceJob(jobId);
  if (!job) {
    logger.warn({ jobId }, "el trabajo de reemplazo de fondo ya no existe — se omite");
    return;
  }

  const startedAt = Date.now();
  const workDir = await mkdtemp(path.join(tmpdir(), "pulso-ve-bg-job-"));
  try {
    const modelPath = process.env.RVM_MODEL_PATH;
    if (!modelPath) throw new Error("RVM_MODEL_PATH no está configurado en el worker del editor de video");

    await db.updateVideoBgReplaceJob(jobId, { status: "procesando", progress: 0, error_message: null });

    // Extensions kept: prepareBackgroundFrameSource decides image-vs-video
    // purely by extension, and ffmpeg is happier with a real one too.
    const sourceLocal = path.join(workDir, `persona${path.extname(job.source_path)}`);
    const backgroundLocal = path.join(workDir, `fondo${path.extname(job.background_path)}`);
    await downloadToFile(service, ASSETS_BUCKET, job.source_path, sourceLocal);
    await downloadToFile(service, ASSETS_BUCKET, job.background_path, backgroundLocal);

    let lastReported = 0;
    const outputLocal = path.join(workDir, "output.mp4");
    await replaceBackgroundSplit(
      sourceLocal,
      backgroundLocal,
      {
        cutPositionFrac: Number(job.cut_position),
        blendBandFrac: Number(job.blend_band),
        workWidth: WORK_WIDTH,
        outputFps: OUTPUT_FPS,
        modelPath,
        onProgress: async (done, total) => {
          // Capped at 99: 100 would read as "done" while the re-encode and
          // upload are still running.
          const pct = Math.min(99, Math.floor((done / total) * 100));
          if (pct - lastReported < PROGRESS_STEP) return;
          lastReported = pct;
          await db.updateVideoBgReplaceJob(jobId, { progress: pct });
        },
      },
      outputLocal,
    );

    const outputPath = `${tenantId}/fondo/${jobId}.mp4`;
    await uploadFile(service, OUTPUT_BUCKET, outputPath, outputLocal, "video/mp4");

    await db.updateVideoBgReplaceJob(jobId, { status: "listo", progress: 100, output_path: outputPath });

    // Free the two raw uploads now that the composited result is safely in
    // the output bucket — unlike a video_project, a bg-replace job has no
    // "re-run with different settings" feature that would need them again;
    // trying a different cut/blend means starting a new job with fresh
    // uploads. Best-effort: a failed cleanup shouldn't flip a finished job
    // to "error".
    try {
      await deleteFiles(service, ASSETS_BUCKET, [job.source_path, job.background_path]);
    } catch (cleanupErr) {
      logger.warn({ jobId, err: cleanupErr }, "no se pudieron borrar los videos crudos del trabajo de reemplazo de fondo");
    }

    logger.info({ jobId, tenantId, durationMs: Date.now() - startedAt }, "bgReplaceJob completado");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err }, "bgReplaceJob falló");
    await db.updateVideoBgReplaceJob(jobId, { status: "error", error_message: message });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
