// The DB-backed twin of pipeline/project.ts's processProject: same
// underlying pipeline functions (probeAsset, parseScriptPdf, transcription,
// buildEdl, buildSubtitleTrack, renderProject), but reading/writing Supabase
// + Storage instead of local JSON files, driven by the BullMQ queue instead
// of a CLI flag. Two entry points, matching the two event types the outbox
// dispatcher routes here (see main.ts): processProjectJob (2.1-2.4, up
// through en_revision) and renderVideoJob (2.5-2.8, one video, re-run per
// preset change — never re-transcribes).

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServiceRoleClient, createTenantScopedClient } from "@pulso/db/worker";
import type { Json } from "@pulso/db/types";
import { createLogger } from "@pulso/shared/logger";
import { probeAsset, detectSilences } from "./pipeline/ffmpeg.js";
import { parseScriptPdf } from "./pipeline/script-pdf.js";
import { getConfiguredProvider, analyzeAudio } from "./pipeline/transcription.js";
import { assignAssetToScript, buildEdl } from "./pipeline/alignment.js";
import { buildSubtitleTrack, toSrt } from "./pipeline/subtitles.js";
import { renderProject } from "./pipeline/render.js";
import { presetSchema, resolveOutputSpec } from "./pipeline/preset.js";
import { edlSchema, subtitleTrackSchema, type AudioAnalysis, type Edl, type ScriptVideo, type SubtitleTrack } from "./pipeline/types.js";
import { ASSETS_BUCKET, OUTPUT_BUCKET, downloadToFile, uploadFile } from "./storage.js";

export interface ProcessProjectJobData {
  projectId: string;
  tenantId: string;
}

export interface RenderVideoJobData {
  projectId: string;
  tenantId: string;
  videoId: string;
}

const logger = createLogger({ agent: "video-editor-db-pipeline" });

// No per-project language setting yet (the ticket's "configurable" is
// satisfied by WHISPER_MODEL_PATH pointing at a language-specific model,
// and by the CLI's --language flag) — every project processed through the
// dashboard is Spanish, matching every tenant this system serves today.
const DEFAULT_LANGUAGE = "es";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, "_");
}

export async function processProjectJob({ projectId, tenantId }: ProcessProjectJobData): Promise<void> {
  const service = createServiceRoleClient();
  const db = createTenantScopedClient(tenantId, service);

  const project = await db.getVideoProject(projectId);
  if (!project) {
    logger.warn({ projectId }, "el proyecto ya no existe — se omite");
    return;
  }

  const startedAt = Date.now();
  try {
    await withTempDir("pulso-ve-process-", async (workDir) => {
      // --- 2.2 Guion -----------------------------------------------------------
      await db.updateVideoProject(projectId, { status: "leyendo_guion" });
      const pdfLocalPath = path.join(workDir, "guion.pdf");
      await downloadToFile(service, ASSETS_BUCKET, project.pdf_path, pdfLocalPath);
      const script = await parseScriptPdf(await readFile(pdfLocalPath));

      // --- 2.1 Ingesta -----------------------------------------------------------
      const assets = await db.listVideoAssets(projectId);
      const localPaths = new Map<string, string>(); // video_assets.id -> local temp file
      for (const asset of assets) {
        const localPath = path.join(workDir, sanitizeName(asset.filename));
        try {
          await downloadToFile(service, ASSETS_BUCKET, asset.path, localPath);
          const probe = await probeAsset(localPath);
          if (!probe.hasAudio) throw new Error("el archivo no tiene pista de audio");
          localPaths.set(asset.id, localPath);
          await db.updateVideoAsset(asset.id, { probe, status: "validado" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await db.updateVideoAsset(asset.id, { status: "error", error_message: message });
          logger.warn({ assetId: asset.id, err }, "asset inválido — se excluye del proyecto");
        }
      }

      const validAssets = assets.filter((a) => localPaths.has(a.id));
      if (validAssets.length === 0) {
        throw new Error("ningún video subido es válido (revisá los mensajes de error de cada archivo)");
      }

      // --- 2.3 Transcripción + silencios ------------------------------------------
      await db.updateVideoProject(projectId, { status: "transcribiendo" });
      const provider = getConfiguredProvider();
      const analyses: AudioAnalysis[] = [];
      for (const asset of validAssets) {
        const localPath = localPaths.get(asset.id)!;
        const silences = await detectSilences(localPath);
        // assetPath is the STORAGE path, not the local temp one: this
        // becomes the EDL segment's `archivo`, and the render job (a
        // separate, later job) re-downloads by storage path into its OWN
        // temp dir — the local path here won't exist anymore by then.
        const rawAnalysis = await analyzeAudio(provider, localPath, DEFAULT_LANGUAGE, silences);
        const analysis: AudioAnalysis = { ...rawAnalysis, assetPath: asset.path };
        analyses.push(analysis);
        await db.updateVideoAsset(asset.id, { analysis: analysis as Json });
      }

      // --- 2.4 Alineación + EDL por cada video del guion --------------------------
      for (const scriptVideo of script.videos) {
        const assigned = analyses.filter((a) => assignAssetToScript(a, script.videos).scriptVideoId === scriptVideo.id);
        if (assigned.length === 0) {
          logger.warn({ projectId, scriptId: scriptVideo.id }, "ningún archivo coincidió con este guion — se omite");
          continue;
        }

        const edl = buildEdl(scriptVideo, assigned);
        const analysesByAsset = new Map(assigned.map((a) => [a.assetPath, a]));
        const subtitleTrack = buildSubtitleTrack(edl, analysesByAsset);

        await db.insertVideoProjectVideo({
          project_id: projectId,
          script_id: scriptVideo.id,
          titulo: scriptVideo.titulo,
          mostrar_titulo: scriptVideo.mostrarTitulo,
          guion: scriptVideo.guion,
          edl: edl as unknown as Json,
          subtitulos: subtitleTrack as unknown as Json,
          necesita_revision: scriptVideo.necesitaRevision,
          status: "en_revision",
        });
      }

      await db.updateVideoProject(projectId, { status: "en_revision" });
    });
    logger.info({ projectId, tenantId, durationMs: Date.now() - startedAt }, "processProjectJob completado");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ projectId, err }, "processProjectJob falló");
    await db.updateVideoProject(projectId, { status: "error", error_message: message });
  }
}

export async function renderVideoJob({ projectId, tenantId, videoId }: RenderVideoJobData): Promise<void> {
  const service = createServiceRoleClient();
  const db = createTenantScopedClient(tenantId, service);

  const [project, videos] = await Promise.all([db.getVideoProject(projectId), db.listVideoProjectVideos(projectId)]);
  const video = videos.find((v) => v.id === videoId);
  if (!project || !video) {
    logger.warn({ projectId, videoId }, "el proyecto o el video ya no existen — se omite");
    return;
  }

  const startedAt = Date.now();
  try {
    await db.updateVideoProjectVideo(videoId, { status: "renderizando", error_message: null });

    const presetRow = await db.getVideoPreset(project.preset_id);
    if (!presetRow) throw new Error(`el preset ${project.preset_id} ya no existe`);
    const preset = presetSchema.parse(presetRow.config);

    const edl = edlSchema.parse(video.edl);
    const subtitleTrack = subtitleTrackSchema.parse(video.subtitulos);
    const scriptVideo: ScriptVideo = {
      id: video.script_id,
      titulo: video.titulo,
      mostrarTitulo: video.mostrar_titulo,
      guion: video.guion,
      // La fila del video project todavía no guarda carpetaTomas/escenas —
      // esta reconstrucción es solo para re-renderizar con el EDL/subtítulos
      // ya generados, que no dependen de ninguno de los dos.
      carpetaTomas: null,
      escenas: [],
      necesitaRevision: video.necesita_revision,
    };

    await withTempDir("pulso-ve-render-", async (workDir) => {
      // Re-download every asset the (possibly hand-edited) EDL still
      // references — the process job's copies are long gone by now, and a
      // re-render after editing the EDL in review might not need every
      // asset that was originally downloaded anyway.
      const uniquePaths = [...new Set((edl as Edl).segmentos.map((s) => s.archivo))];
      const localByStoragePath = new Map<string, string>();
      for (const storagePath of uniquePaths) {
        const localPath = path.join(workDir, sanitizeName(path.basename(storagePath)));
        await downloadToFile(service, ASSETS_BUCKET, storagePath, localPath);
        localByStoragePath.set(storagePath, localPath);
      }
      const localEdl: Edl = {
        ...(edl as Edl),
        segmentos: (edl as Edl).segmentos.map((s) => ({ ...s, archivo: localByStoragePath.get(s.archivo)! })),
      };

      let musicLocalPath: string | undefined;
      if (project.music_path) {
        musicLocalPath = path.join(workDir, "music" + path.extname(project.music_path));
        await downloadToFile(service, ASSETS_BUCKET, project.music_path, musicLocalPath);
      }

      const firstAssetProbe = await probeAsset(localEdl.segmentos[0]!.archivo);
      const outputSpec = resolveOutputSpec(preset, firstAssetProbe);

      const outputMp4Local = path.join(workDir, "output.mp4");
      await renderProject(localEdl, scriptVideo, subtitleTrack as SubtitleTrack, preset, outputSpec, outputMp4Local, {
        musicPath: musicLocalPath,
      });

      const outputSrtLocal = path.join(workDir, "output.srt");
      await writeFile(outputSrtLocal, toSrt(subtitleTrack as SubtitleTrack, preset.subtitulos.maxCaracteresPorLinea, preset.subtitulos.maxLineas), "utf8");

      const outputMp4Path = `${tenantId}/${projectId}/${video.script_id}.mp4`;
      const outputSrtPath = `${tenantId}/${projectId}/${video.script_id}.srt`;
      await uploadFile(service, OUTPUT_BUCKET, outputMp4Path, outputMp4Local, "video/mp4");
      await uploadFile(service, OUTPUT_BUCKET, outputSrtPath, outputSrtLocal, "text/plain");

      await db.updateVideoProjectVideo(videoId, {
        status: "listo",
        output_mp4_path: outputMp4Path,
        output_srt_path: outputSrtPath,
      });
    });
    logger.info({ projectId, videoId, tenantId, durationMs: Date.now() - startedAt }, "renderVideoJob completado");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ projectId, videoId, err }, "renderVideoJob falló");
    await db.updateVideoProjectVideo(videoId, { status: "error", error_message: message });
  }
}
