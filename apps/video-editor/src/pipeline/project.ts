// Orchestrates one project run end to end, writing every intermediate JSON
// artifact to `<outDir>/artifacts/` and skipping a stage entirely when its
// artifact file already exists — this IS the "any step can be re-run
// without repeating the ones before it" requirement, not just a comment
// about it: change the preset and re-run, and probing/transcription/
// alignment are read from disk instead of redone.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@pulso/shared/logger";
import { probeAsset, detectSilences } from "./ffmpeg.js";
import { parseScriptPdf } from "./script-pdf.js";
import { getConfiguredProvider, analyzeAudio } from "./transcription.js";
import { assignAssetToScript, buildEdl } from "./alignment.js";
import { buildSubtitleTrack, toSrt } from "./subtitles.js";
import { renderProject } from "./render.js";
import { loadDefaultPreset, loadPreset, resolveOutputSpec, type Preset } from "./preset.js";
import {
  audioAnalysisSchema,
  edlSchema,
  scriptDocumentSchema,
  subtitleTrackSchema,
  type AssetProbe,
  type AudioAnalysis,
  type Edl,
  type ScriptDocument,
} from "./types.js";

const logger = createLogger({ agent: "video-editor" });

export interface ProcessProjectOptions {
  videoPaths: string[];
  pdfPath: string;
  outDir: string;
  language?: string | undefined;
  presetPath?: string | undefined;
  musicPath?: string | undefined;
  force?: boolean | undefined;
}

export interface ProcessProjectResult {
  videoId: string;
  outputMp4Path: string;
  outputSrtPath: string;
  edlPath: string;
  manifestPath: string;
}

function assetArtifactName(assetPath: string): string {
  return path.basename(assetPath).replace(/[^a-zA-Z0-9.-]/g, "_");
}

async function readJsonIfExists<T>(filePath: string, schema: { parse(v: unknown): T }): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") return undefined;
    throw err;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function processProject(options: ProcessProjectOptions): Promise<ProcessProjectResult[]> {
  const artifactsDir = path.join(options.outDir, "artifacts");
  const outputDir = path.join(options.outDir, "output");
  const language = options.language ?? "es";
  const force = options.force ?? false;
  const preset: Preset = options.presetPath ? await loadPreset(options.presetPath) : await loadDefaultPreset();

  // --- 2.1 Ingesta -----------------------------------------------------------
  const probesByAsset = new Map<string, AssetProbe>();
  for (const videoPath of options.videoPaths) {
    const probe = await probeAsset(videoPath);
    if (!probe.hasAudio) {
      throw new Error(`"${videoPath}" no tiene pista de audio — no se puede usar en el editor de video.`);
    }
    probesByAsset.set(videoPath, probe);
    logger.info({ videoPath, probe }, "asset validado");
  }

  // --- 2.2 Guion ---------------------------------------------------------------
  const scriptPath = path.join(artifactsDir, "script.json");
  let script = force ? undefined : await readJsonIfExists(scriptPath, scriptDocumentSchema);
  if (!script) {
    const pdfBuffer = await readFile(options.pdfPath);
    script = await parseScriptPdf(pdfBuffer);
    await writeJson(scriptPath, script);
  }
  const needsReview = script.videos.filter((v) => v.necesitaRevision);
  if (needsReview.length > 0) {
    logger.warn(
      { videos: needsReview.map((v) => v.id) },
      "guiones marcados para revisión manual (el parser de encabezados no encontró un título explícito)",
    );
  }

  // --- 2.3 Transcripción + silencios (por archivo, cacheado) ------------------
  const provider = getConfiguredProvider();
  const analyses: AudioAnalysis[] = [];
  for (const videoPath of options.videoPaths) {
    const audioArtifactPath = path.join(artifactsDir, "audio", `${assetArtifactName(videoPath)}.json`);
    let analysis = force ? undefined : await readJsonIfExists(audioArtifactPath, audioAnalysisSchema);
    if (!analysis) {
      const silences = await detectSilences(videoPath);
      analysis = await analyzeAudio(provider, videoPath, language, silences);
      await writeJson(audioArtifactPath, analysis);
    }
    analyses.push(analysis);
  }
  const analysesByAsset = new Map(analyses.map((a) => [a.assetPath, a]));

  // --- 2.4 Alineación + EDL ----------------------------------------------------
  const results: ProcessProjectResult[] = [];
  for (const scriptVideo of (script as ScriptDocument).videos) {
    const assigned: AudioAnalysis[] = [];
    for (const analysis of analyses) {
      const assignment = assignAssetToScript(analysis, (script as ScriptDocument).videos);
      if (assignment.scriptVideoId === scriptVideo.id) assigned.push(analysis);
    }
    if (assigned.length === 0) {
      logger.warn({ videoId: scriptVideo.id }, "ningún archivo coincidió con este guion — se omite");
      continue;
    }

    const edlPath = path.join(artifactsDir, "edl", `${scriptVideo.id}.json`);
    let edl = force ? undefined : await readJsonIfExists(edlPath, edlSchema);
    if (!edl) {
      edl = buildEdl(
        scriptVideo,
        assigned,
        preset.transiciones ? { marginSec: preset.transiciones.margenSilencioSeg } : {},
      );
      await writeJson(edlPath, edl);
    }

    // --- 2.6 Subtítulos -------------------------------------------------------
    const subtitlesPath = path.join(artifactsDir, "subtitles", `${scriptVideo.id}.json`);
    let subtitleTrack = force ? undefined : await readJsonIfExists(subtitlesPath, subtitleTrackSchema);
    if (!subtitleTrack) {
      subtitleTrack = buildSubtitleTrack(
        edl as Edl,
        analysesByAsset,
        preset.subtitulos.palabrasPorBloque,
        preset.transiciones?.activo ? preset.transiciones.duracionSeg : 0,
      );
      await writeJson(subtitlesPath, subtitleTrack);
    }

    // --- 2.5/2.7/2.8 Título, música y render -----------------------------------
    const firstSourceProbe = probesByAsset.get((edl as Edl).segmentos[0]!.archivo)!;
    const outputSpec = resolveOutputSpec(preset, firstSourceProbe);

    await mkdir(outputDir, { recursive: true });
    const outputMp4Path = path.join(outputDir, `${scriptVideo.id}.mp4`);
    await renderProject(edl as Edl, scriptVideo, subtitleTrack, preset, outputSpec, outputMp4Path, {
      musicPath: options.musicPath,
    });

    const outputSrtPath = path.join(outputDir, `${scriptVideo.id}.srt`);
    await writeFile(
      outputSrtPath,
      toSrt(subtitleTrack, preset.subtitulos.maxCaracteresPorLinea, preset.subtitulos.maxLineas),
      "utf8",
    );

    const manifestPath = path.join(outputDir, `${scriptVideo.id}.manifest.json`);
    await writeJson(manifestPath, {
      videoId: scriptVideo.id,
      generatedAt: new Date().toISOString(),
      transcriptionProvider: provider.name,
      presetId: preset.id,
      outputSpec,
      musicPath: options.musicPath ?? null,
      sourceAssets: assigned.map((a) => a.assetPath),
    });

    results.push({ videoId: scriptVideo.id, outputMp4Path, outputSrtPath, edlPath, manifestPath });
  }

  return results;
}

/** Convenience for the CLI: lists every *.mp4 directly inside a directory. */
export async function listMp4sInDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".mp4"))
    .map((e) => path.join(dir, e.name))
    .sort();
}
