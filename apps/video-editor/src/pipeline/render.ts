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
import { computeSegmentStartOffsets, sceneKeyForFile } from "./alignment.js";
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
        // concat requires every input on the same sample aspect ratio, not
        // just the same pixel dimensions — two real source files can scale
        // to the identical WxH here and still disagree on SAR by a rounding
        // hair (confirmed on real footage: 1:1 vs 1520:1521), which concat
        // refuses outright ("do not match") rather than silently misrendering.
        `pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2,fps=${spec.fps},setsar=1[v${i}]`,
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
  /** Any ffmpeg xfade transition name (fade, zoomin, dissolve, wipeleft...). */
  tipo: string;
  duracionSeg: number;
  /** 0 disables the opening zoom entirely. */
  zoomInicialSeg: number;
}

/**
 * Same job as concatenateSegments, but joins consecutive DIFFERENT scenes
 * with a quick native ffmpeg xfade transition (transitions.tipo — "fade" by
 * default, but any ffmpeg xfade name works) instead of a hard cut. Parts of
 * the SAME scene (see sceneKeyForFile: a real crew's own retake/continuation
 * split, e.g. "-PARTE-01"/"-PARTE-02") stay a plain hard cut — no transition
 * at all — on purpose: an xfade/acrossfade overlaps the last D seconds of
 * the outgoing clip with the first D seconds of the incoming one, and a
 * same-scene join is exactly where that overlap lands ON somebody's actual
 * words. Confirmed on real footage: a light-leak-style xfade there faded out
 * the tail of "ochocientos" mid-word while the next take's audio was
 * already fading in underneath it, and the same D applied to a
 * different-scene join risks the same thing at scene boundaries. Kept short
 * by default for exactly that reason — long enough to read as a quick
 * visual flourish, short enough to rarely land squarely on a spoken word.
 *
 * ffmpeg's xfade/acrossfade/concat only join TWO streams at a time, so this
 * chains them pairwise left to right. computeSegmentStartOffsets (shared
 * with subtitles.ts — the two MUST agree on this or subtitle timing drifts
 * later and later after every transition) gives each join's exact offset
 * and the actual final duration, shorter than the naive sum of segment
 * durations by D per real transition (same-scene hard cuts don't shorten
 * anything).
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
  const offsets = computeSegmentStartOffsets(edl.segmentos, D);

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
        // xfade/concat require every input on the same timebase AND the same
        // sample aspect ratio — mismatched timebases fail loud ("do not
        // match"), but a mismatched SAR (confirmed on real footage: one
        // source's rounding left it at 1520:1521 instead of 1:1) fails
        // exactly the same way on `concat` even though `xfade` tolerated it,
        // so setsar=1 is non-negotiable here, not just cosmetic.
        `pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2,fps=${spec.fps}${openingZoom},setsar=1,settb=1/${spec.fps}[v${i}]`,
    );
    filterParts.push(`[${inputIdx}:a]atrim=start=${segment.inicio}:end=${segment.fin},asetpts=PTS-STARTPTS[a${i}]`);
  });

  let videoLabel = "v0";
  let audioLabel = "a0";

  for (let i = 1; i < edl.segmentos.length; i++) {
    const nextVideoLabel = `vx${i}`;
    const nextAudioLabel = `ax${i}`;

    if (sameSceneAsPrev[i]) {
      // Plain hard cut — same as concatenateSegments, no overlap to eat
      // into either side's audio. concat's own output lands on a DIFFERENT
      // timebase than the settb=1/fps every segment was normalized to
      // (confirmed on real footage: 1/1000000 vs 1/30) — a later xfade
      // chained onto this label fails the same "do not match" way a raw
      // unnormalized input would, so it needs re-normalizing here too, not
      // just once at the very start of the chain.
      filterParts.push(`[${videoLabel}][v${i}]concat=n=2:v=1:a=0[vc${i}]`);
      filterParts.push(`[vc${i}]settb=1/${spec.fps}[${nextVideoLabel}]`);
      filterParts.push(`[${audioLabel}][a${i}]concat=n=2:v=0:a=1[${nextAudioLabel}]`);
    } else {
      filterParts.push(
        `[${videoLabel}][v${i}]xfade=transition=${transitions.tipo}:duration=${D}:offset=${offsets[i]}[${nextVideoLabel}]`,
      );
      filterParts.push(`[${audioLabel}][a${i}]acrossfade=d=${D}[${nextAudioLabel}]`);
    }

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

  const last = edl.segmentos[edl.segmentos.length - 1]!;
  return offsets[offsets.length - 1]! + (last.fin - last.inicio);
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
        tipo: preset.transiciones.tipo,
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
