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
import { DEFAULT_EDL_MARGIN_SEC, assignAssetToScript, buildEdl } from "./alignment.js";
import { anchorSegmentOpenings } from "./segment-anchor.js";
import { buildSubtitleTrack, toSrt } from "./subtitles.js";
import { applyEscenaTreatments, type ApplyEscenaTreatmentsOptions } from "./escena-treatment.js";
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
  /**
   * Tomas a procesar. Opcional cuando el guion trae "Carpeta:" en algún
   * video Y se pasa `tomasBaseDir` — en ese caso se resuelven solas (ver
   * resolveVideoPathsForScript). Lo que sí se pase acá se procesa igual,
   * además de lo resuelto automáticamente.
   */
  videoPaths?: string[] | undefined;
  pdfPath: string;
  outDir: string;
  language?: string | undefined;
  presetPath?: string | undefined;
  musicPath?: string | undefined;
  force?: boolean | undefined;
  /** Carpeta raíz donde viven las tomas crudas de todos los guiones — ver resolveVideoPathsForScript. */
  tomasBaseDir?: string | undefined;
  /** Manifiesto de b-roll (b-roll.ts) — necesario solo si alguna escena trae un requisito "[fondo: ...]"/"[apoyo: ...]". */
  bRollLibraryPath?: string | undefined;
  /** Necesario solo si algún requisito es "fondo" — por defecto usa RVM_MODEL_PATH del entorno. */
  rvmModelPath?: string | undefined;
  backgroundReplace?: ApplyEscenaTreatmentsOptions["backgroundReplace"] | undefined;
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

/** "ADS 01", "ads_01" and "ADS-01" are the same folder name to a person — and to this. */
function normalizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resuelve la línea "Carpeta: <valor>" de un guion contra las tomas
 * realmente en disco. Dos modos, según lo que haya en `tomasBaseDir`:
 *  - una subcarpeta cuyo nombre sea el mismo ignorando mayúsculas y
 *    separadores ("Carpeta: ADS-01" encuentra "ADS 01" — confirmado con la
 *    reorganización real de AZ), y se listan sus mp4 (organización "una
 *    carpeta por anuncio").
 *  - si no hay, se buscan en `tomasBaseDir` (sin subcarpetas) los mp4 cuyo
 *    NOMBRE contenga "<valor>-" — no solo como prefijo: el metraje real de
 *    AZ mezcla "ADS-04-ESCENA-02.MP4" con retakes tipo
 *    "BLOQUE-02-ADS-04-ESCENA-02.MP4", y un filtro de prefijo estricto
 *    dejaría afuera esos segundos silenciosamente.
 */
export async function resolveVideoPathsForScript(carpetaTomas: string, tomasBaseDir: string): Promise<string[]> {
  const wanted = normalizeFolderName(carpetaTomas);
  const entries = await readdir(tomasBaseDir, { withFileTypes: true });
  const subdir = entries.find((e) => e.isDirectory() && normalizeFolderName(e.name) === wanted);
  if (subdir) {
    return listMp4sInDir(path.join(tomasBaseDir, subdir.name));
  }

  const needle = `${wanted}-`;
  const enCarpetaBase = await listMp4sInDir(tomasBaseDir);
  const matched = enCarpetaBase.filter((p) => normalizeFolderName(path.basename(p)).includes(needle));
  if (matched.length === 0) {
    throw new Error(
      `no se encontró ninguna toma para "Carpeta: ${carpetaTomas}" en "${tomasBaseDir}" ` +
        `(ni como subcarpeta ni como parte de un nombre de archivo)`,
    );
  }
  return matched;
}

export async function processProject(options: ProcessProjectOptions): Promise<ProcessProjectResult[]> {
  const artifactsDir = path.join(options.outDir, "artifacts");
  const outputDir = path.join(options.outDir, "output");
  const language = options.language ?? "es";
  const force = options.force ?? false;
  const preset: Preset = options.presetPath ? await loadPreset(options.presetPath) : await loadDefaultPreset();

  // --- 2.2 Guion (antes de la ingesta: "Carpeta:" decide qué tomas se procesan) ---
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

  // --- Resolución automática de tomas + tratamiento de escenas (fondo/apoyo) ---
  const videoPaths = [...(options.videoPaths ?? [])];
  if (options.tomasBaseDir) {
    for (const scriptVideo of script.videos) {
      if (!scriptVideo.carpetaTomas) continue;
      const raw = await resolveVideoPathsForScript(scriptVideo.carpetaTomas, options.tomasBaseDir);
      const treated =
        scriptVideo.escenas.length > 0 && options.bRollLibraryPath
          ? await applyEscenaTreatments(raw, scriptVideo.escenas, {
              bRollLibraryPath: options.bRollLibraryPath,
              workDir: path.join(artifactsDir, "tratadas"),
              rvmModelPath: options.rvmModelPath ?? process.env.RVM_MODEL_PATH,
              backgroundReplace: options.backgroundReplace,
              force,
            })
          : raw;
      videoPaths.push(...treated);
    }
  }
  const uniqueVideoPaths = [...new Set(videoPaths)];
  if (uniqueVideoPaths.length === 0) {
    throw new Error(
      "no hay tomas para procesar — pasá videoPaths explícito, o asegurate de que el guion tenga una línea " +
        '"Carpeta:" junto con tomasBaseDir.',
    );
  }

  // --- 2.1 Ingesta -----------------------------------------------------------
  const probesByAsset = new Map<string, AssetProbe>();
  for (const videoPath of uniqueVideoPaths) {
    const probe = await probeAsset(videoPath);
    if (!probe.hasAudio) {
      throw new Error(`"${videoPath}" no tiene pista de audio — no se puede usar en el editor de video.`);
    }
    probesByAsset.set(videoPath, probe);
    logger.info({ videoPath, probe }, "asset validado");
  }

  // --- 2.3 Transcripción + silencios (por archivo, cacheado) ------------------
  const provider = getConfiguredProvider();
  const analyses: AudioAnalysis[] = [];
  for (const videoPath of uniqueVideoPaths) {
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
      const marginSec = preset.transiciones?.margenSilencioSeg ?? DEFAULT_EDL_MARGIN_SEC;
      const built = buildEdl(scriptVideo, assigned, { marginSec });
      // Each segment must open on its first script word — see segment-anchor.ts
      // for why the full-file timings aren't trusted for that.
      const anchored = await anchorSegmentOpenings(built, analysesByAsset, provider, language, marginSec);
      edl = anchored.edl;
      for (const assetPath of anchored.retimedAssets) {
        const audioArtifactPath = path.join(artifactsDir, "audio", `${assetArtifactName(assetPath)}.json`);
        await writeJson(audioArtifactPath, analysesByAsset.get(assetPath));
      }
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
