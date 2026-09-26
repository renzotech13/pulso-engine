// Optional pre-processing step, run on a raw take BEFORE it ever reaches
// alignment/EDL/render: replaces the upper portion of a shot's background
// with a different still image OR video, blending down into the shot's OWN
// original background lower in the frame — a "split background" that reads
// as a visual cutaway without literally cutting the shot. Uses Robust Video
// Matting (RVM, github.com/PeterL1n/RobustVideoMatting) for the person
// cutout: unlike an image background remover run frame-by-frame, RVM is
// built for VIDEO and carries its own recurrent state across frames
// specifically to avoid the flicker a per-frame segmenter produces on a
// talking-head shot. The output is a normal MP4 (original audio muxed back
// in unchanged) meant to be fed into the pipeline's --videos list exactly
// like any other raw take — everything downstream (alignment, transitions,
// LUT, subtitles) treats it the same as an unmodified source file.

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { AppError } from "@pulso/shared/errors";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export class BackgroundReplaceError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "BACKGROUND_REPLACE_ERROR", cause);
    this.name = "BackgroundReplaceError";
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm"]);

function isVideoPath(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Either a static image or a video used as the replacement background. When
 * it's a video, its frames are extracted once (matching the source's own
 * fps/width) and looped by index if it's shorter than the source shot.
 */
interface BackgroundFrameSource {
  /** Path to read a given 1-based source-frame index's background frame from. */
  framePathFor(sourceFrameIndex: number): string;
}

async function prepareBackgroundFrameSource(
  backgroundPath: string,
  workDir: string,
  workWidth: number,
  fps: number,
): Promise<BackgroundFrameSource> {
  if (!isVideoPath(backgroundPath)) {
    return { framePathFor: () => backgroundPath };
  }
  const bgFramesDir = path.join(workDir, "bg-frames");
  const bgFrameCount = await extractFrames(backgroundPath, bgFramesDir, workWidth, fps);
  return {
    framePathFor: (sourceFrameIndex: number) => {
      const loopedIndex = ((sourceFrameIndex - 1) % bgFrameCount) + 1;
      return path.join(bgFramesDir, `frame-${String(loopedIndex).padStart(5, "0")}.png`);
    },
  };
}

export interface BackgroundReplaceOptions {
  /**
   * Where the blend is centered, as a fraction of frame height (0 = very
   * top, 1 = very bottom). 0.5 puts the seam roughly at chest height on a
   * standing presenter framed head-to-waist.
   */
  cutPositionFrac: number;
  /** How much of the frame height the blend band spans — wider reads as a softer, more gradual transition. */
  blendBandFrac: number;
  /**
   * Which slice of the background image/video gets kept once it's cropped
   * down to cover its (usually much shorter than the full frame) visible
   * zone — 0 keeps the TOP of the source, 1 the bottom, 0.5 (default) the
   * vertical center, same as before this existed. Matters most for a
   * vertical (9:16) background clip: center-cropping it to a short zone
   * grabs the source's own vertical middle, which for a typically-framed
   * clip (subject centered top-to-bottom in ITS OWN frame) often lands
   * right around where the presenter's own head starts once placed at the
   * top of the composite — biasing toward 0 shows more of the source's
   * upper portion instead, clear of that overlap.
   */
  backgroundPositionY?: number;
  /** Frame width to process and output at. Downscaling before matting (RVM is per-frame, not free) is fine — the pipeline's own concatenateSegments scales every segment to the preset's output size anyway. */
  workWidth: number;
  /** Path to an RVM ONNX model (see RVM_MODEL_PATH) — resnet50 for quality, mobilenetv3 for speed. */
  modelPath: string;
  /**
   * Frames per second to process and output at. RVM runs once per frame, so
   * matching the source's own (often ~60fps) rate wastes real time on
   * frames the pipeline's later scale/fps-normalize step would have
   * discarded anyway — 30fps halves the frame count on a 60fps source with
   * no visible quality cost once it's re-encoded at the preset's own fps
   * regardless.
   */
  outputFps?: number;
  /** Called after each frame is composited, for a caller that wants to report progress (e.g. a queued job). */
  onProgress?: (frameIndex: number, frameCount: number) => void | Promise<void>;
}

/** RVM's own documented ONNX convention: a single zero VALUE (not an empty tensor) for the initial recurrent state. */
function zeroRecurrentState(): ort.Tensor {
  return new ort.Tensor("float32", new Float32Array([0]), [1, 1, 1, 1]);
}

/** Guideline from RVM's docs: keep the downsampled internal resolution between 256 and 512px on the long-ish side for a portrait/talking-head shot. */
function downsampleRatioFor(width: number): number {
  if (width <= 512) return 1;
  if (width <= 720) return 0.6;
  return 512 / width;
}

/**
 * How tall the background actually needs to be, in px, to cover every row
 * the blend gradient below can ever show ANY of it — past
 * `cutPositionFrac + blendBandFrac/2`, the gradient's own weight for the
 * new background is already exactly 0 (see the `t` formula in
 * runMattingAndComposite), so covering further down would be wasted work.
 * Exported so bg-replace-multi-cli.ts's reel-building can target the SAME
 * height instead of guessing its own — resizing a background to cover the
 * full frame height and then having this function shrink it right back
 * down would upscale it for nothing, then throw that detail away.
 */
export function backgroundCoverHeight(frameHeight: number, cutPositionFrac: number, blendBandFrac: number): number {
  const zoneFrac = Math.min(1, cutPositionFrac + blendBandFrac / 2);
  return Math.max(1, Math.round(frameHeight * zoneFrac));
}

async function extractFrames(videoPath: string, framesDir: string, workWidth: number, fps: number): Promise<number> {
  await mkdir(framesDir, { recursive: true });
  try {
    await run(
      "ffmpeg",
      ["-y", "-i", videoPath, "-vf", `fps=${fps},scale=${workWidth}:-2`, path.join(framesDir, "frame-%05d.png")],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new BackgroundReplaceError('"ffmpeg" no está instalado o no está en el PATH.', err);
    throw new BackgroundReplaceError(`no se pudieron extraer los cuadros de "${videoPath}"`, err);
  }
  const frames = (await readdir(framesDir)).filter((f) => f.endsWith(".png"));
  if (frames.length === 0) {
    throw new BackgroundReplaceError(`ffmpeg no extrajo ningún cuadro de "${videoPath}"`);
  }
  return frames.length;
}

/**
 * Runs every extracted frame through RVM (sequentially — the model is
 * recurrent, frames MUST be processed in order with the previous frame's
 * output state fed into the next) and writes a gradient-blended,
 * foreground-composited PNG for each one.
 */
async function runMattingAndComposite(
  framesDir: string,
  frameCount: number,
  background: BackgroundFrameSource,
  outDir: string,
  options: BackgroundReplaceOptions,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const session = await ort.InferenceSession.create(options.modelPath);

  let r1i = zeroRecurrentState();
  let r2i = zeroRecurrentState();
  let r3i = zeroRecurrentState();
  let r4i = zeroRecurrentState();
  const downsampleRatio = new ort.Tensor("float32", new Float32Array([downsampleRatioFor(options.workWidth)]), [1]);

  // Cached by source-background path, not just by size — a video background
  // supplies a different frame path each iteration, so the cache must be
  // invalidated whenever the underlying image changes, not only on resize.
  let backgroundResized: { data: Buffer; width: number; height: number; sourcePath: string } | undefined;

  for (let i = 1; i <= frameCount; i++) {
    const frameName = `frame-${String(i).padStart(5, "0")}.png`;
    const framePath = path.join(framesDir, frameName);

    const { data: srcData, info } = await sharp(framePath).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    const bgFramePath = background.framePathFor(i);
    if (
      !backgroundResized ||
      backgroundResized.width !== width ||
      backgroundResized.height !== height ||
      backgroundResized.sourcePath !== bgFramePath
    ) {
      // Only cover down to where the blend gradient can still show any of
      // it — resizing to the FULL frame height would force e.g. a 16:9
      // landscape clip to blow up ~2.7x to cover a 9:16 frame top-to-
      // bottom, when the corte/difuminado actually only ever reveal the
      // top slice of it. bgCoverHeight is that real, usually much
      // shorter, height.
      const bgCoverHeight = backgroundCoverHeight(height, options.cutPositionFrac, options.blendBandFrac);
      // sharp's own `fit: "cover"` always crops centered — cropping the
      // scale-to-cover result ourselves is what lets backgroundPositionY
      // pick a different slice (see its own doc comment on why that
      // matters for a vertical source). Ceil, not round, on the scaled
      // size: extract() below needs it to be AT LEAST width×bgCoverHeight,
      // and a stray round-down would make it 1px short and throw.
      const srcMeta = await sharp(bgFramePath).metadata();
      const srcWidth = srcMeta.width ?? width;
      const srcHeight = srcMeta.height ?? bgCoverHeight;
      const coverScale = Math.max(width / srcWidth, bgCoverHeight / srcHeight);
      const scaledWidth = Math.ceil(srcWidth * coverScale);
      const scaledHeight = Math.ceil(srcHeight * coverScale);
      const positionY = options.backgroundPositionY ?? 0.5;
      const top = Math.round(Math.max(0, scaledHeight - bgCoverHeight) * positionY);
      const left = Math.round(Math.max(0, scaledWidth - width) / 2); // horizontal stays centered — only the vertical slice is configurable
      const resized = await sharp(bgFramePath)
        .resize(scaledWidth, scaledHeight)
        .extract({ left, top, width, height: bgCoverHeight })
        .raw()
        .toBuffer({ resolveWithObject: true });
      backgroundResized = { data: resized.data, width, height: bgCoverHeight, sourcePath: bgFramePath };
    }

    const chw = new Float32Array(3 * width * height);
    for (let pix = 0; pix < width * height; pix++) {
      const idx = pix * channels;
      chw[pix] = srcData[idx]! / 255;
      chw[width * height + pix] = srcData[idx + 1]! / 255;
      chw[2 * width * height + pix] = srcData[idx + 2]! / 255;
    }
    const src = new ort.Tensor("float32", chw, [1, 3, height, width]);

    const results = await session.run({ src, r1i, r2i, r3i, r4i, downsample_ratio: downsampleRatio });
    r1i = results.r1o!;
    r2i = results.r2o!;
    r3i = results.r3o!;
    r4i = results.r4o!;
    const fgr = results.fgr!;
    const pha = results.pha!;

    // Vertical gradient: 0 = fully the NEW background (top), 1 = fully the
    // shot's OWN original background (bottom) — computed once per frame
    // size since it only depends on height, not pixel content.
    const bandStart = options.cutPositionFrac - options.blendBandFrac / 2;
    const outBuf = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      const t = Math.max(0, Math.min(1, (y / height - bandStart) / options.blendBandFrac));
      for (let x = 0; x < width; x++) {
        const pix = y * width + x;
        // Clamped, not `pix`: backgroundResized is only bgCoverHeight tall
        // now, shorter than the frame — rows below it get t=1 anyway (the
        // gradient already ignores newBg entirely there), so which row
        // gets read back doesn't affect the output, it just has to stay
        // in bounds.
        const bgRow = Math.min(y, backgroundResized.height - 1);
        const bgIdx = (bgRow * width + x) * 3; // background images are opaque RGB (fit: cover)
        const newBg = [backgroundResized.data[bgIdx]!, backgroundResized.data[bgIdx + 1]!, backgroundResized.data[bgIdx + 2]!];
        const origBg = [srcData[pix * channels]!, srcData[pix * channels + 1]!, srcData[pix * channels + 2]!];
        const alpha = Math.max(0, Math.min(1, pha.data[pix] as number));

        for (let c = 0; c < 3; c++) {
          const blendedBg = newBg[c]! * (1 - t) + origBg[c]! * t;
          const fg = Math.max(0, Math.min(1, fgr.data[c * width * height + pix] as number)) * 255;
          outBuf[pix * 3 + c] = Math.round(blendedBg * (1 - alpha) + fg * alpha);
        }
      }
    }

    await sharp(outBuf, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(path.join(outDir, frameName));

    await options.onProgress?.(i, frameCount);
  }
}

/**
 * Re-encodes the composited PNG sequence back to video at the source's
 * original fps, then muxes the SOURCE's own audio track back in unchanged —
 * this step never touches audio, so whisper transcription/alignment behaves
 * identically to processing the unmodified source file.
 */
async function encodeWithOriginalAudio(
  framesDir: string,
  fps: number,
  originalVideoPath: string,
  outputVideoPath: string,
): Promise<void> {
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        "-framerate", String(fps),
        "-i", path.join(framesDir, "frame-%05d.png"),
        "-i", originalVideoPath,
        "-map", "0:v",
        "-map", "1:a?",
        "-c:v", "libx264",
        "-crf", "16",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-shortest",
        outputVideoPath,
      ],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new BackgroundReplaceError('"ffmpeg" no está instalado o no está en el PATH.', err);
    throw new BackgroundReplaceError(`no se pudo recodificar "${outputVideoPath}" con el audio original`, err);
  }
}

/**
 * Produces a new MP4 at `outputVideoPath`: the same shot, with its upper
 * portion's background replaced by `backgroundPath` (a still image OR a
 * video — a video is looped by frame index if it's shorter than the shot)
 * and a soft vertical blend down into the shot's own original background.
 * Safe to feed straight into the normal --videos pipeline afterward — same
 * audio, same content, just a different background in the frame.
 */
export async function replaceBackgroundSplit(
  sourceVideoPath: string,
  backgroundPath: string,
  options: BackgroundReplaceOptions,
  outputVideoPath: string,
): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "pulso-bg-replace-"));
  const fps = options.outputFps ?? 30;
  try {
    await mkdir(path.dirname(outputVideoPath), { recursive: true });
    const framesDir = path.join(workDir, "frames");
    const outDir = path.join(workDir, "out");
    const frameCount = await extractFrames(sourceVideoPath, framesDir, options.workWidth, fps);
    const background = await prepareBackgroundFrameSource(backgroundPath, workDir, options.workWidth, fps);
    await runMattingAndComposite(framesDir, frameCount, background, outDir, options);
    await encodeWithOriginalAudio(outDir, fps, sourceVideoPath, outputVideoPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
