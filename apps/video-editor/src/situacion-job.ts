// Trabajo del preset "situación con voz en off" (evento video.ugc.requested con preset = 'situacion'):
// voz (ElevenLabs por ID o audio subido, con velocidad) → 4 imágenes (la 1 sin referencia, las demás con la 1
// para mantener a la misma persona) → 4 videos Seedance 1.0 Pro Fast 720p → armado con los elementos de marca
// en 9:16 y 4:5, ambos con zona segura. Un video negro (fallo de la API) se regenera solo.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createServiceRoleClient, createTenantScopedClient } from "@pulso/db/worker";
import { createLogger } from "@pulso/shared/logger";
import {
  SITUACION_COSTO_ESTIMADO_USD,
  promptAnimacionSituacion,
  promptImagenSituacion,
  situacionSchema,
  ugcElementosSchema,
} from "@pulso/shared/ugc";
import { ASSETS_BUCKET, OUTPUT_BUCKET, downloadToFile, uploadFile } from "./storage.js";
import { generarImagenSituacion, generarVideoSeedance, saldoApimart, subirImagen } from "./ugc/apimart.js";
import { armarSituacion } from "./ugc/situaciones.js";
import { ajustarVelocidad, ttsElevenLabs } from "./ugc/voz.js";

const exec = promisify(execFile);
const logger = createLogger({ agent: "video-editor-situacion" });
const PATH_HERRAMIENTAS = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;

/** Brillo medio (0-255) de un cuadro a los 2.5 s: un clip negro de la API da ~0. */
async function brillo(video: string): Promise<number> {
  const { stdout } = await exec(
    "bash",
    ["-c", `ffmpeg -loglevel error -ss 2.5 -i '${video}' -vf 'scale=16:16,format=gray' -frames:v 1 -f rawvideo - | python3 -c "import sys;b=sys.stdin.buffer.read();print(round(sum(b)/max(len(b),1)))"`],
    { env: { ...process.env, PATH: PATH_HERRAMIENTAS } },
  );
  return Number(stdout.trim()) || 0;
}

export async function situacionJob({ jobId, tenantId }: { jobId: string; tenantId: string }): Promise<void> {
  const service = createServiceRoleClient();
  const db = createTenantScopedClient(tenantId, service);
  const job = await db.getVideoUgcJob(jobId);
  if (!job) return;
  if (job.status === "listo") return;

  const workDir = await mkdtemp(path.join(tmpdir(), "pulso-ve-sit-"));
  let costo = Number(job.cost_usd);
  try {
    const sit = situacionSchema.parse(job.situacion);
    const elementos = ugcElementosSchema.parse(job.elementos);

    const saldo = await saldoApimart();
    await db.updateVideoUgcJob(jobId, { saldo_apimart: saldo, status: "generando", progress: 3, error_message: null });
    if (saldo < SITUACION_COSTO_ESTIMADO_USD) {
      throw new Error(`Saldo de APIMart insuficiente (US$${saldo.toFixed(2)}) — recarga la cuenta y reintenta este video`);
    }

    // 1) Voz en off
    const vozCruda = path.join(workDir, "voz-cruda.mp3");
    if (sit.voz.origen === "elevenlabs") await ttsElevenLabs(sit.guion, sit.voz.voiceId, vozCruda);
    else await downloadToFile(service, ASSETS_BUCKET, sit.voz.audioPath, vozCruda);
    const voz = path.join(workDir, "voz.mp3");
    await ajustarVelocidad(vozCruda, voz, sit.velocidad);
    await db.updateVideoUgcJob(jobId, { progress: 8 });

    // 2) Imágenes: la 1 primero (sin referencia); las demás en paralelo usando la 1 como referencia.
    const imgs = [1, 2, 3, 4].map((n) => path.join(workDir, `toma-${n}.png`));
    const c1 = await generarImagenSituacion(promptImagenSituacion(sit, 0), imgs[0]!);
    costo += c1.costoUsd;
    const refUrl = await subirImagen(imgs[0]!);
    const restantes = await Promise.all(
      [1, 2, 3].map((i) => generarImagenSituacion(promptImagenSituacion(sit, i), imgs[i]!, sit.tomas[i]!.otraPersona ? undefined : refUrl)),
    );
    costo += restantes.reduce((a, r) => a + r.costoUsd, 0);
    await db.updateVideoUgcJob(jobId, { progress: 30, cost_usd: costo });

    // 3) Videos (4 en paralelo). Si uno sale negro se regenera hasta 2 veces.
    const vids = [1, 2, 3, 4].map((n) => path.join(workDir, `toma-${n}.mp4`));
    const costos = await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        const url = await subirImagen(imgs[i]!);
        let c = 0;
        for (let intento = 0; intento < 3; intento++) {
          const r = await generarVideoSeedance(promptAnimacionSituacion(sit.tomas[i]!), url, vids[i]!);
          c += r.costoUsd;
          if ((await brillo(vids[i]!)) > 20) return c;
          logger.warn({ jobId, toma: i + 1 }, "clip negro de la API: se regenera");
        }
        throw new Error(`la toma ${i + 1} salió negra 3 veces seguidas`);
      }),
    );
    costo += costos.reduce((a, b) => a + b, 0);
    await db.updateVideoUgcJob(jobId, { progress: 70, cost_usd: costo, status: "armando" });

    // 4) Armado en 9:16 y 4:5 (la voz manda el largo y el reparto de las tomas).
    const salidaDir = path.join(workDir, "salida");
    await mkdir(salidaDir, { recursive: true });
    const titulo = elementos.titulo ?? { clave: "movistar-titulo-ola-pill", lineas: ["", ""] };
    const archivos = await armarSituacion({
      workDir: path.join(workDir, "armado"),
      voz,
      tomas: vids as [string, string, string, string],
      titulo,
      precio: elementos.precio?.clave ?? "movistar-precio-ilimitado",
      colaSeg: sit.colaSeg,
      guion: sit.guion,
      elementos,
      salida: path.join(salidaDir, "video"),
    });
    await db.updateVideoUgcJob(jobId, { progress: 92 });

    const out916 = `${tenantId}/ugc/${jobId}.mp4`;
    const out45 = `${tenantId}/ugc/${jobId}-4x5.mp4`;
    await uploadFile(service, OUTPUT_BUCKET, out916, archivos.find((f) => f.endsWith("-9x16.mp4"))!, "video/mp4");
    await uploadFile(service, OUTPUT_BUCKET, out45, archivos.find((f) => f.endsWith("-4x5.mp4"))!, "video/mp4");
    const saldoFinal = await saldoApimart().catch(() => null);
    await db.updateVideoUgcJob(jobId, {
      status: "listo",
      progress: 100,
      output_path: out916,
      task_ids: { salida45: out45 },
      cost_usd: costo,
      ...(saldoFinal !== null ? { saldo_apimart: saldoFinal } : {}),
    });
    logger.info({ jobId, costo }, "video de situación listo");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err }, "falló el trabajo de situación");
    await db.updateVideoUgcJob(jobId, { status: "error", error_message: message.slice(0, 500), cost_usd: costo });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
