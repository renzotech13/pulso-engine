// Trabajo de la Fábrica de video UGC (evento video.ugc.requested): descarga la
// foto de la protagonista, pide a APIMart el primer tramo y su extensión,
// arma el video con los elementos elegidos y lo sube al bucket de salida.
// Los task_id y el costo real de APIMart quedan guardados en la fila.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServiceRoleClient, createTenantScopedClient } from "@pulso/db/worker";
import { createLogger } from "@pulso/shared/logger";
import { construirPromptUgc, normalizarGuionUgc, promptPrimerCuadroUgc, ugcElementosSchema, UGC_COSTO_ESTIMADO_USD } from "@pulso/shared/ugc";
import { ASSETS_BUCKET, OUTPUT_BUCKET, downloadToFile, uploadFile } from "./storage.js";
import { situacionJob } from "./situacion-job.js";
import { extenderTramo, generarImagenSituacion, generarPrimerTramo, saldoApimart, subirImagen } from "./ugc/apimart.js";
import { ensamblarUgc } from "./ugc/ensamblar.js";

const logger = createLogger({ agent: "video-editor-ugc" });

export interface UgcJobData {
  jobId: string;
  tenantId: string;
}

export async function ugcJob({ jobId, tenantId }: UgcJobData): Promise<void> {
  const service = createServiceRoleClient();
  const db = createTenantScopedClient(tenantId, service);

  const job = await db.getVideoUgcJob(jobId);
  if (!job) {
    logger.warn({ jobId }, "el trabajo UGC ya no existe — se omite");
    return;
  }
  if (job.status === "listo") return; // evento repetido: ya está hecho
  if (job.preset === "situacion") {
    await situacionJob({ jobId, tenantId });
    return;
  }
  if (!job.frame_path || !job.escena || !job.guion_a || !job.guion_b) {
    await db.updateVideoUgcJob(jobId, { status: "error", error_message: "faltan datos del video UGC (foto, escena o guiones)" });
    return;
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "pulso-ve-ugc-"));
  const startedAt = Date.now();
  // Cada corrida parte de cero (regenerar = video nuevo): el costo acumulado de
  // corridas anteriores queda en cost_usd para no perder la cuenta del gasto.
  let costo = Number(job.cost_usd);
  const taskIds: { primer?: string; extension?: string; salida45?: string } = {};

  try {
    const elementos = ugcElementosSchema.parse(job.elementos);
    const guionA = normalizarGuionUgc(job.guion_a);
    const guionB = normalizarGuionUgc(job.guion_b);

    // Antes de gastar: el saldo tiene que alcanzar para este video.
    const saldo = await saldoApimart();
    await db.updateVideoUgcJob(jobId, { saldo_apimart: saldo });
    if (saldo < UGC_COSTO_ESTIMADO_USD) {
      throw new Error(`Saldo de APIMart insuficiente (US$${saldo.toFixed(2)}) — recarga la cuenta y reintenta este video`);
    }

    const tramo1 = path.join(workDir, "tramo1.mp4");
    const ext = path.join(workDir, "extension.mp4");

    await db.updateVideoUgcJob(jobId, { status: "generando", progress: 5, error_message: null });
    const frame = path.join(workDir, `protagonista${path.extname(job.frame_path) || ".png"}`);
    await downloadToFile(service, ASSETS_BUCKET, job.frame_path, frame);
    let url = await subirImagen(frame);
    const gen = job.situacion as { generarPrimerCuadro?: boolean; ropa?: string } | null;
    if (gen?.generarPrimerCuadro) {
      // La foto subida es una REFERENCIA: se genera el primer cuadro (misma persona, ropa y escena nuevas) y ese es el que se anima.
      await db.updateVideoUgcJob(jobId, { progress: 8 });
      const generado = path.join(workDir, "primer-cuadro.png");
      const im = await generarImagenSituacion(promptPrimerCuadroUgc(job.escena, gen.ropa), generado, url);
      costo += im.costoUsd;
      url = await subirImagen(generado);
      await uploadFile(service, OUTPUT_BUCKET, `${tenantId}/ugc/${jobId}-primer-cuadro.png`, generado, "image/png");
    }
    const r = await generarPrimerTramo(job.model, construirPromptUgc(job.escena, guionA, false), url, tramo1);
    costo += r.costoUsd;
    taskIds.primer = r.taskId;
    await db.updateVideoUgcJob(jobId, { progress: 35, task_ids: taskIds, cost_usd: costo });

    await db.updateVideoUgcJob(jobId, { status: "extendiendo", progress: 40 });
    const e = await extenderTramo(job.model, construirPromptUgc(job.escena, guionB, true), taskIds.primer!, ext);
    costo += e.costoUsd;
    taskIds.extension = e.taskId;
    await db.updateVideoUgcJob(jobId, { progress: 58, task_ids: taskIds, cost_usd: costo });

    await db.updateVideoUgcJob(jobId, { status: "armando", progress: 60 });
    // Cada video sale en dos versiones: 9:16 con zona segura y 4:5 (recorte con su propia zona segura).
    const w916 = path.join(workDir, "v916");
    const w45 = path.join(workDir, "v45");
    await mkdir(w916, { recursive: true });
    await mkdir(w45, { recursive: true });
    const final = await ensamblarUgc({
      workDir: w916,
      tramo1,
      extension: ext,
      elementos: { ...elementos, formato: "9:16" },
      guionSubtitulos: `${guionA} ${guionB}`,
      onPaso: async (_p, progreso) => {
        await db.updateVideoUgcJob(jobId, { progress: Math.min(progreso, 85) });
      },
    });
    await db.updateVideoUgcJob(jobId, { progress: 88 });
    const final45 = await ensamblarUgc({ workDir: w45, tramo1, extension: ext, elementos: { ...elementos, formato: "4:5" }, guionSubtitulos: `${guionA} ${guionB}` });

    const outputPath = `${tenantId}/ugc/${jobId}.mp4`;
    const output45 = `${tenantId}/ugc/${jobId}-4x5.mp4`;
    await uploadFile(service, OUTPUT_BUCKET, outputPath, final, "video/mp4");
    await uploadFile(service, OUTPUT_BUCKET, output45, final45, "video/mp4");
    taskIds.salida45 = output45;
    const saldoFinal = await saldoApimart().catch(() => null);
    await db.updateVideoUgcJob(jobId, {
      status: "listo",
      progress: 100,
      output_path: outputPath,
      task_ids: taskIds,
      cost_usd: costo,
      ...(saldoFinal !== null ? { saldo_apimart: saldoFinal } : {}),
    });
    logger.info({ jobId, costo, ms: Date.now() - startedAt }, "video UGC listo");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err }, "falló el trabajo UGC");
    await db.updateVideoUgcJob(jobId, { status: "error", error_message: message.slice(0, 500), cost_usd: costo, task_ids: taskIds });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
