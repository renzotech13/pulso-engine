// 2.8: the only stage that touches ffmpeg for actual video composition.
// Four ffmpeg-adjacent steps: (1) trim+normalize+concat the EDL's segments
// into one video, (2) normalize the voice and mix in music if there is any
// (2.7, music.ts), (3) ask Remotion (via @pulso/render-video) for a
// transparent-background overlay video with the title and styled
// subtitles, (4) ffmpeg composites the overlay onto the concatenated
// footage WITH the mixed audio and does the final encode. Remotion never
// sees the source footage, the music, or does the encode — that split is
// deliberate (see the Fase 0 writeup on Remotion vs ASS).

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { renderLocal } from "@pulso/render-video/render";
import { AppError } from "@pulso/shared/errors";
import { denoiseAudio } from "./denoise.js";
import { extractAudioForDenoise, FfmpegNotFoundError, InvalidMediaError } from "./ffmpeg.js";
import { mixAudio } from "./music.js";
import { resolveSubtitleAnimation, resolveTitleAnimation, type Preset } from "./preset.js";
import type { Edl, ScriptVideo, SubtitleTrack } from "./types.js";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export class RenderError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "RENDER_ERROR", cause);
    this.name = "RenderError";
  }
}

export interface OutputSpec {
  width: number;
  height: number;
  fps: number;
  /** libx264 CRF for the final encode — lower is higher quality/bigger file. */
  crf: number;
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

function edlDurationSec(edl: Edl): number {
  return edl.segmentos.reduce((total, s) => total + (s.fin - s.inicio), 0);
}

/**
 * Groups a raw take with its own retakes/parts of the SAME scene — real crews
 * commonly split one continuous scene across files ("ADS-01-ESCENA-03-PARTE-01",
 * "...-PARTE-02") when a recording gets stopped and restarted. Two segments
 * whose files share everything up to that "-PARTE-N" suffix are the same
 * scene; anything else (a different scene, a different take with no PARTE
 * suffix at all) gets its own key. Best-effort: a tenant with a different
 * naming convention just gets every segment treated as its own scene, which
 * is the same behavior as before this existed.
 */
function sceneKeyForFile(filePath: string): string {
  const base = path.basename(filePath).replace(/\.[^.]+$/, "");
  return base.replace(/-parte-?\d+$/i, "");
}

/**
 * One ffmpeg invocation: every segment gets its own trim+(LUT)+scale+pad+fps
 * filter chain (normalizing away any source resolution/fps mismatch), then
 * the concat filter joins them — a single pass, no per-segment temp files.
 * Segments that repeat the same source file reuse ONE `-i` for it (ffmpeg
 * seeks internally per trim), so a 3-take file isn't opened three times.
 */
async function concatenateSegments(
  edl: Edl,
  spec: OutputSpec,
  outputPath: string,
  colorLutPath: string | undefined,
): Promise<void> {
  if (edl.segmentos.length === 0) {
    throw new RenderError(`el guion "${edl.videoId}" no tiene ningún segmento en su EDL — nada que renderizar`);
  }

  const uniqueFiles = [...new Set(edl.segmentos.map((s) => s.archivo))];
  const fileIndex = new Map(uniqueFiles.map((file, i) => [file, i]));

  const inputArgs = uniqueFiles.flatMap((file) => ["-i", file]);

  // Applied BEFORE scale/pad — a log profile's values aren't perceptually
  // linear, so grading first and resizing the already-graded image matches
  // normal color-pipeline order (and how an NLE would do it), rather than
  // interpolating log-encoded pixels during the resize.
  const colorLut = colorLutPath
    ? `,format=gbrp16le,lut3d=file=${colorLutPath}:interp=tetrahedral,format=yuv420p`
    : "";

  const filterParts: string[] = [];
  const concatRefs: string[] = [];
  edl.segmentos.forEach((segment, i) => {
    const inputIdx = fileIndex.get(segment.archivo)!;
    filterParts.push(
      `[${inputIdx}:v]trim=start=${segment.inicio}:end=${segment.fin},setpts=PTS-STARTPTS${colorLut},` +
        `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=decrease,` +
        `pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2,fps=${spec.fps}[v${i}]`,
    );
    filterParts.push(`[${inputIdx}:a]atrim=start=${segment.inicio}:end=${segment.fin},asetpts=PTS-STARTPTS[a${i}]`);
    concatRefs.push(`[v${i}][a${i}]`);
  });
  filterParts.push(`${concatRefs.join("")}concat=n=${edl.segmentos.length}:v=1:a=1[outv][outa]`);

  try {
    await run(
      "ffmpeg",
      [
        "-y",
        ...inputArgs,
        "-filter_complex", filterParts.join(";"),
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264",
        "-crf", String(spec.crf),
        "-pix_fmt", "yuv420p",
        // Audio here is an intermediate for mixAudio (music.ts) to
        // loudnorm/mix, not the final track — AAC is lossy, so this stays
        // uncompressed PCM to not compound quality loss across two encodes.
        "-c:a", "pcm_s16le",
        outputPath,
      ],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffmpeg", err);
    throw new InvalidMediaError(edl.videoId, "no se pudieron unir los segmentos de la EDL", err);
  }
}

export interface TransitionOptions {
  duracionSeg: number;
  /** 0 disables the opening zoom entirely. */
  zoomInicialSeg: number;
}

/**
 * Same job as concatenateSegments, but joins consecutive segments with a
 * transition instead of a hard cut — a quick native ffmpeg zoom-in between
 * two DIFFERENT scenes, and a bright flash (xfade's own "fadewhite") between
 * two parts of the SAME scene (see sceneKeyForFile: a real crew's own
 * retake/continuation split, e.g. "-PARTE-01"/"-PARTE-02"). Both are a
 * SINGLE xfade — real overlapping dissolves, not an inserted clip — so
 * neither one adds any duration: the transition happens ON TOP of the last D
 * seconds of the outgoing take and the first D seconds of the incoming one,
 * exactly at the cut, never as its own extra shot. (An earlier version tried
 * the light-leak as two chained xfades through an inserted color clip — that
 * DID add real screen time, which is exactly the "toma aparte" this is
 * built to avoid.) The very first segment also gets a brief opening zoom-in.
 *
 * ffmpeg's xfade/acrossfade only join TWO streams at a time, so this chains
 * them pairwise left to right, tracking the combined timeline's duration so
 * far to compute each next `offset`.
 *
 * Returns the ACTUAL output duration — shorter than the naive sum of segment
 * durations, since every xfade/acrossfade overlaps D seconds of the two
 * clips it joins. Callers that need the real length for anything downstream
 * (music fades, audio trimming) must use this, not edlDurationSec.
 */
async function concatenateSegmentsWithTransitions(
  edl: Edl,
  spec: OutputSpec,
  outputPath: string,
  colorLutPath: string | undefined,
  transitions: TransitionOptions,
): Promise<number> {
  if (edl.segmentos.length === 0) {
    throw new RenderError(`el guion "${edl.videoId}" no tiene ningún segmento en su EDL — nada que renderizar`);
  }
  // Nothing to transition between — same output shape as the plain path.
  if (edl.segmentos.length === 1) {
    await concatenateSegments(edl, spec, outputPath, colorLutPath);
    return edlDurationSec(edl);
  }

  const uniqueFiles = [...new Set(edl.segmentos.map((s) => s.archivo))];
  const fileIndex = new Map(uniqueFiles.map((file, i) => [file, i]));
  const inputArgs = uniqueFiles.flatMap((file) => ["-i", file]);

  const colorLut = colorLutPath
    ? `,format=gbrp16le,lut3d=file=${colorLutPath}:interp=tetrahedral,format=yuv420p`
    : "";

  const D = transitions.duracionSeg;
  const sameSceneAsPrev = edl.segmentos.map(
    (s, i) => i > 0 && sceneKeyForFile(s.archivo) === sceneKeyForFile(edl.segmentos[i - 1]!.archivo),
  );

  const filterParts: string[] = [];

  edl.segmentos.forEach((segment, i) => {
    const inputIdx = fileIndex.get(segment.archivo)!;
    const openingZoom =
      i === 0 && transitions.zoomInicialSeg > 0
        ? `,crop=w='iw*(1-0.12*min(t/${transitions.zoomInicialSeg}\\,1))':h='ih*(1-0.12*min(t/${transitions.zoomInicialSeg}\\,1))':x='(iw-ow)/2':y='(ih-oh)/2',scale=${spec.width}:${spec.height}`
        : "";
    filterParts.push(
      `[${inputIdx}:v]trim=start=${segment.inicio}:end=${segment.fin},setpts=PTS-STARTPTS${colorLut},` +
        `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=decrease,` +
        // xfade requires both sides on the same timebase — mismatched
        // timebases across separately-decoded/filtered inputs fail loud
        // ("do not match") rather than silently misbehaving.
        `pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2,fps=${spec.fps}${openingZoom},settb=1/${spec.fps}[v${i}]`,
    );
    filterParts.push(`[${inputIdx}:a]atrim=start=${segment.inicio}:end=${segment.fin},asetpts=PTS-STARTPTS[a${i}]`);
  });

  let videoLabel = "v0";
  let audioLabel = "a0";
  let accumulated = edl.segmentos[0]!.fin - edl.segmentos[0]!.inicio;

  for (let i = 1; i < edl.segmentos.length; i++) {
    const segDur = edl.segmentos[i]!.fin - edl.segmentos[i]!.inicio;
    const nextVideoLabel = `vx${i}`;
    const offset = accumulated - D;
    const transitionType = sameSceneAsPrev[i] ? "fadewhite" : "zoomin";
    filterParts.push(
      `[${videoLabel}][v${i}]xfade=transition=${transitionType}:duration=${D}:offset=${offset}[${nextVideoLabel}]`,
    );
    accumulated = accumulated + segDur - D;

    const nextAudioLabel = `ax${i}`;
    filterParts.push(`[${audioLabel}][a${i}]acrossfade=d=${D}[${nextAudioLabel}]`);

    videoLabel = nextVideoLabel;
    audioLabel = nextAudioLabel;
  }

  try {
    await run(
      "ffmpeg",
      [
        "-y",
        ...inputArgs,
        "-filter_complex", filterParts.join(";"),
        "-map", `[${videoLabel}]`,
        "-map", `[${audioLabel}]`,
        "-c:v", "libx264",
        "-crf", String(spec.crf),
        "-pix_fmt", "yuv420p",
        "-c:a", "pcm_s16le",
        outputPath,
      ],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffmpeg", err);
    throw new InvalidMediaError(edl.videoId, "no se pudieron unir los segmentos de la EDL con transiciones", err);
  }

  return accumulated;
}

function buildOverlayProps(
  preset: Preset,
  scriptVideo: ScriptVideo,
  subtitleTrack: SubtitleTrack,
  durationSec: number,
  spec: OutputSpec,
) {
  const { subtitulos: s, titulo: tt } = preset;
  return {
    durationSec,
    fps: spec.fps,
    width: spec.width,
    height: spec.height,
    fuente: { familia: preset.fuente.familia, archivo: preset.fuente.archivo, peso: preset.fuente.peso },
    subtitulos: subtitleTrack.bloques.map((b) => ({
      startSec: b.startSec,
      endSec: b.endSec,
      text: b.text,
      words: b.words,
    })),
    subtituloEstilo: {
      tamano: s.tamano,
      color: s.color,
      colorPalabraActiva: s.colorPalabraActiva,
      contorno: s.contorno,
      sombra: s.sombra,
      fondo: s.fondo,
      posicion: s.posicion,
      margenSeguroInferiorPx: s.margenSeguroInferiorPx,
      maxCaracteresPorLinea: s.maxCaracteresPorLinea,
      maxLineas: s.maxLineas,
      mayusculas: s.mayusculas,
      resaltarPalabraActiva: s.resaltarPalabraActiva,
      animacion: resolveSubtitleAnimation(s.animacion),
    },
    // Absent entirely (not just empty text) when the script says not to show
    // one — Overlay.tsx treats "no titulo prop" and "titulo for 0 seconds"
    // differently only in intent, but omitting it is the honest signal.
    titulo:
      scriptVideo.mostrarTitulo && scriptVideo.titulo
        ? {
            texto: scriptVideo.titulo,
            modo: tt.modo,
            duracionSeg: tt.duracionSeg,
            tamano: tt.tamano,
            color: tt.color,
            fondo: tt.fondo,
            posicion: tt.posicion,
            margenSeguroPx: tt.margenSeguroPx,
            animacionEntrada: resolveTitleAnimation(tt.animacionEntrada) === "fadeIn" ? ("fadeIn" as const) : ("ninguna" as const),
            animacionSalida: resolveTitleAnimation(tt.animacionSalida) === "fadeOut" ? ("fadeOut" as const) : ("ninguna" as const),
            entradaSeg: tt.entradaSeg,
            salidaSeg: tt.salidaSeg,
          }
        : undefined,
  };
}

async function renderOverlay(
  preset: Preset,
  scriptVideo: ScriptVideo,
  subtitleTrack: SubtitleTrack,
  durationSec: number,
  spec: OutputSpec,
): Promise<Buffer> {
  return renderLocal("overlay", buildOverlayProps(preset, scriptVideo, subtitleTrack, durationSec, spec), {
    codec: "prores-4444",
  });
}

async function compositeOverlay(
  concatenatedVideoPath: string,
  overlayPath: string,
  audioPath: string,
  spec: OutputSpec,
  outputPath: string,
): Promise<void> {
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        "-i", concatenatedVideoPath,
        "-i", overlayPath,
        "-i", audioPath,
        "-filter_complex", "[0:v][1:v]overlay=format=auto[outv]",
        "-map", "[outv]",
        "-map", "2:a",
        "-c:v", "libx264",
        "-crf", String(spec.crf),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac",
        "-shortest",
        outputPath,
      ],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffmpeg", err);
    throw new RenderError("no se pudo componer el overlay y el audio final sobre el video", err);
  }
}

export interface RenderProjectResult {
  outputMp4Path: string;
}

export interface RenderProjectOptions {
  musicPath?: string | undefined;
}

/**
 * The full 2.8 pipeline for one script's EDL. Everything happens inside one
 * temp directory that's removed in `finally` — on success AND on failure,
 * per the ticket's "no huérfanos" requirement.
 */
export async function renderProject(
  edl: Edl,
  scriptVideo: ScriptVideo,
  subtitleTrack: SubtitleTrack,
  preset: Preset,
  spec: OutputSpec,
  outputMp4Path: string,
  options: RenderProjectOptions = {},
): Promise<RenderProjectResult> {
  const workDir = await mkdtemp(path.join(tmpdir(), "pulso-video-editor-"));
  try {
    // .mov, not .mp4: this carries uncompressed PCM audio (see
    // concatenateSegments) as an intermediate for mixAudio to process,
    // which MP4's muxer doesn't support cleanly the way QuickTime's does.
    const concatenatedPath = path.join(workDir, "concatenated.mov");
    let durationSec: number;
    if (preset.transiciones?.activo) {
      durationSec = await concatenateSegmentsWithTransitions(edl, spec, concatenatedPath, preset.correccionColor?.lutPath, {
        duracionSeg: preset.transiciones.duracionSeg,
        zoomInicialSeg: preset.transiciones.zoomInicialSeg,
      });
    } else {
      await concatenateSegments(edl, spec, concatenatedPath, preset.correccionColor?.lutPath);
      durationSec = edlDurationSec(edl);
    }

    // Denoising happens on the concatenated voice track, BEFORE loudnorm and
    // any music ducking — the model expects to see the voice's real noise
    // floor, not one that's already been normalized/mixed. When not
    // configured, mixAudio reads the concatenated file's own audio directly,
    // same as before this feature existed.
    let voicePath = concatenatedPath;
    if (preset.limpiezaAudio?.activo) {
      const rawVoicePath = path.join(workDir, "voice-raw.wav");
      await extractAudioForDenoise(concatenatedPath, rawVoicePath);
      const denoisedVoicePath = path.join(workDir, "voice-denoised.wav");
      await denoiseAudio(rawVoicePath, denoisedVoicePath, process.env.DEEP_FILTER_BIN_PATH);
      voicePath = denoisedVoicePath;
    }

    const mixedAudioPath = path.join(workDir, "mixed-audio.wav");
    await mixAudio(voicePath, options.musicPath, preset.musica, durationSec, mixedAudioPath);

    const overlayBuffer = await renderOverlay(preset, scriptVideo, subtitleTrack, durationSec, spec);
    const overlayPath = path.join(workDir, "overlay.mov");
    await writeFile(overlayPath, overlayBuffer);

    await compositeOverlay(concatenatedPath, overlayPath, mixedAudioPath, spec, outputMp4Path);
    return { outputMp4Path };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
