// 2.8: the only stage that touches ffmpeg for actual video composition.
// Three ffmpeg-adjacent steps: (1) trim+normalize+concat the EDL's segments
// into one video, (2) ask Remotion (via @pulso/render-video) for a
// transparent-background overlay video with the subtitle text, (3) ffmpeg
// composites the overlay onto the concatenated footage and does the final
// encode. Remotion never sees the source footage or does the encode —
// that split is deliberate (see the Fase 0 writeup on Remotion vs ASS).

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { renderLocal } from "@pulso/render-video/render";
import { AppError } from "@pulso/shared/errors";
import { FfmpegNotFoundError, InvalidMediaError } from "./ffmpeg.js";
import type { AssetProbe, Edl, SubtitleTrack } from "./types.js";

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

export const DEFAULT_OUTPUT_SPEC: OutputSpec = { width: 1080, height: 1920, fps: 30, crf: 18 };

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

function edlDurationSec(edl: Edl): number {
  return edl.segmentos.reduce((total, s) => total + (s.fin - s.inicio), 0);
}

/**
 * One ffmpeg invocation: every segment gets its own trim+scale+pad+fps
 * filter chain (normalizing away any source resolution/fps mismatch), then
 * the concat filter joins them — a single pass, no per-segment temp files.
 * Segments that repeat the same source file reuse ONE `-i` for it (ffmpeg
 * seeks internally per trim), so a 3-take file isn't opened three times.
 */
async function concatenateSegments(edl: Edl, spec: OutputSpec, outputPath: string): Promise<void> {
  if (edl.segmentos.length === 0) {
    throw new RenderError(`el guion "${edl.videoId}" no tiene ningún segmento en su EDL — nada que renderizar`);
  }

  const uniqueFiles = [...new Set(edl.segmentos.map((s) => s.archivo))];
  const fileIndex = new Map(uniqueFiles.map((file, i) => [file, i]));

  const inputArgs = uniqueFiles.flatMap((file) => ["-i", file]);

  const filterParts: string[] = [];
  const concatRefs: string[] = [];
  edl.segmentos.forEach((segment, i) => {
    const inputIdx = fileIndex.get(segment.archivo)!;
    filterParts.push(
      `[${inputIdx}:v]trim=start=${segment.inicio}:end=${segment.fin},setpts=PTS-STARTPTS,` +
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
        "-c:a", "aac",
        outputPath,
      ],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffmpeg", err);
    throw new InvalidMediaError(edl.videoId, "no se pudieron unir los segmentos de la EDL", err);
  }
}

async function renderSubtitleOverlay(track: SubtitleTrack, durationSec: number, spec: OutputSpec): Promise<Buffer> {
  return renderLocal(
    "subtitle-overlay",
    {
      bloques: track.bloques.map((b) => ({ startSec: b.startSec, endSec: b.endSec, text: b.text })),
      durationSec,
      fps: spec.fps,
      width: spec.width,
      height: spec.height,
    },
    { codec: "prores-4444" },
  );
}

async function compositeOverlay(
  concatenatedPath: string,
  overlayPath: string,
  spec: OutputSpec,
  outputPath: string,
): Promise<void> {
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        "-i", concatenatedPath,
        "-i", overlayPath,
        "-filter_complex", "[0:v][1:v]overlay=format=auto[outv]",
        "-map", "[outv]",
        "-map", "0:a",
        "-c:v", "libx264",
        "-crf", String(spec.crf),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac",
        outputPath,
      ],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffmpeg", err);
    throw new RenderError("no se pudo componer el overlay de subtítulos sobre el video", err);
  }
}

export interface RenderProjectResult {
  outputMp4Path: string;
}

/**
 * The full 2.8 pipeline for one script's EDL. Everything happens inside one
 * temp directory that's removed in `finally` — on success AND on failure,
 * per the ticket's "no huérfanos" requirement.
 */
export async function renderProject(
  edl: Edl,
  subtitleTrack: SubtitleTrack,
  outputMp4Path: string,
  spec: OutputSpec = DEFAULT_OUTPUT_SPEC,
): Promise<RenderProjectResult> {
  const workDir = await mkdtemp(path.join(tmpdir(), "pulso-video-editor-"));
  try {
    const concatenatedPath = path.join(workDir, "concatenated.mp4");
    await concatenateSegments(edl, spec, concatenatedPath);

    const durationSec = edlDurationSec(edl);
    const overlayBuffer = await renderSubtitleOverlay(subtitleTrack, durationSec, spec);
    const overlayPath = path.join(workDir, "overlay.mov");
    await writeFile(overlayPath, overlayBuffer);

    await compositeOverlay(concatenatedPath, overlayPath, spec, outputMp4Path);
    return { outputMp4Path };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Re-exported so callers building an OutputSpec can validate a probed asset against it if they need to. */
export type { AssetProbe };
