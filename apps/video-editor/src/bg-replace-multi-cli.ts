// Variant of bg-replace-cli.ts for the common case of SEVERAL background
// takes instead of one: given a folder of clips, builds a single background
// reel by giving each clip an equal share of the person video's own
// duration (looping a clip that's shorter than its share, trimming one
// that's longer), concatenating them in filename order, then runs the
// exact same split-background RVM composite as bg-replace-cli.ts on that
// reel — same corte/difuminado, and just as untouched by subtitles/title/
// LUT, since those live in pipeline/render.ts, never imported here either.

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { probeAsset } from "./pipeline/ffmpeg.js";
import { backgroundCoverHeight, replaceBackgroundSplit } from "./pipeline/background-replace.js";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm"]);

function usageError(): never {
  console.error(
    "uso: tsx src/bg-replace-multi-cli.ts <video-persona> <carpeta-tomas-fondo> <video-salida> " +
      "[--corte 0.5] [--difuminado 0.15] [--ancho 1080] [--fps 30] [--modelo ruta.onnx] " +
      "[--seg-min 5] [--seg-max 6] [--fondo-posicion-y 0.5]",
  );
  process.exit(1);
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

/**
 * Matches ffmpeg's own `scale=W:-2` rounding (nearest even) — the PERSON's
 * own frame height at this workWidth, i.e. what `replaceBackgroundSplit`'s
 * extractFrames will produce for the person. Only an input to
 * backgroundCoverHeight below, never the reel's own target height directly
 * — the reel needs just the visible slice of that, not the whole thing.
 */
function evenHeightForWidth(targetWidth: number, sourceWidth: number, sourceHeight: number): number {
  return Math.round(((targetWidth * sourceHeight) / sourceWidth / 2)) * 2;
}

function toEven(n: number): number {
  return Math.round(n / 2) * 2;
}

/**
 * One re-encoded segment per background clip, all at the EXACT same
 * width x height so the concat demuxer's stream-copy step below can just
 * paste them together — concat with `-c copy` requires matching
 * parameters across segments, and a folder of background clips is rarely
 * all the same aspect ratio (stock footage is often 16:9 landscape or 1:1
 * square, not the 9:16 portrait the final reel needs). Each clip is
 * scaled up to COVER the target box, then center-cropped down to it
 * (never stretched) — matches the pipeline's own request to always come
 * out full-frame and centered, cropping the sides if needed, rather than
 * letterboxing or distorting.
 *
 * `targetHeight` is `backgroundCoverHeight`'s answer, not the person's full
 * frame height — covering further down than the blend gradient ever
 * reveals would force a low or mismatched-aspect clip (a 1280x720
 * landscape take, say) to blow itself up far more than it needs to, only
 * for the resize inside runMattingAndComposite to immediately shrink it
 * back down and throw that away.
 *
 * `perClipSec` is a fixed share of the person video's duration, not each
 * clip's own length, so N clips always add up to (about) the full duration
 * regardless of how long any individual take actually runs.
 *
 * `positionY` (0-1) picks which vertical slice of a clip survives the crop
 * — 0.5 (default) keeps the center, same as before this existed; see
 * background-replace.ts's own `backgroundPositionY` doc for why a vertical
 * source clip often wants something lower than that. Horizontal stays
 * centered regardless — only ever cropping the sides, never the picked
 * vertical slice.
 */
async function buildBackgroundReel(
  clipPaths: string[],
  personaDurationSec: number,
  workDir: string,
  workWidth: number,
  targetHeight: number,
  fps: number,
  segMinSec: number,
  segMaxSec: number,
  positionY: number,
): Promise<string> {
  const rawShare = personaDurationSec / clipPaths.length;
  const perClipSec = Math.min(segMaxSec, Math.max(segMinSec, rawShare));

  const segmentsDir = path.join(workDir, "bg-segments");
  await mkdir(segmentsDir, { recursive: true });

  // A single corrupt/incomplete download in the folder (a truncated 4K
  // stock clip, say — "moov atom not found" is the classic sign) shouldn't
  // fail every OTHER video that happens to share this same background
  // folder — at real batch volume (lote-cli.ts running over a folder of
  // clips across dozens of videos) that one bad file would otherwise block
  // all of them. A skipped clip just means the reel comes out a bit
  // shorter than perClipSec × N — replaceBackgroundSplit already loops a
  // background that's shorter than the source shot, so nothing downstream
  // needs to know a clip went missing.
  const segmentPaths: string[] = [];
  for (const [i, clipPath] of clipPaths.entries()) {
    const segmentPath = path.join(segmentsDir, `seg-${String(i).padStart(2, "0")}.mp4`);
    try {
      await run(
        "ffmpeg",
        [
          "-y",
          // Loops the clip as many times as it takes to cover perClipSec —
          // a no-op once the clip is already that long, since -t cuts
          // before a second loop would ever be read.
          "-stream_loop", "-1",
          "-i", clipPath,
          "-t", perClipSec.toFixed(3),
          "-vf",
          `scale=${workWidth}:${targetHeight}:force_original_aspect_ratio=increase,` +
            `crop=${workWidth}:${targetHeight}:(iw-ow)/2:(ih-oh)*${positionY},fps=${fps}`,
          "-an",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "20",
          segmentPath,
        ],
        { maxBuffer: MAX_BUFFER },
      );
      segmentPaths.push(segmentPath);
    } catch (err) {
      if (isEnoent(err)) throw new Error('"ffmpeg" no está instalado o no está en el PATH.');
      const reason = String(err).split("\n")[0];
      console.warn(`atención: se salteó la toma de fondo "${clipPath}" — no se pudo procesar (¿corrupta o descarga incompleta?): ${reason}`);
    }
  }
  if (segmentPaths.length === 0) {
    throw new Error(`ninguna de las ${clipPaths.length} toma(s) de fondo pudo procesarse — revisá que no estén corruptas o incompletas`);
  }

  const listPath = path.join(workDir, "bg-list.txt");
  // Concat demuxer file list — single quotes escaped per its own syntax
  // (not shell syntax: ffmpeg reads this file itself, no shell involved).
  await writeFile(listPath, segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");

  const reelPath = path.join(workDir, "bg-reel.mp4");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", reelPath], { maxBuffer: MAX_BUFFER });
  return reelPath;
}

async function main() {
  const [source, backgroundFolder, output, ...rest] = process.argv.slice(2);
  if (!source || !backgroundFolder || !output) usageError();

  const flag = (name: string, fallback: string): string => {
    const idx = rest.indexOf(`--${name}`);
    return idx !== -1 && rest[idx + 1] ? rest[idx + 1]! : fallback;
  };

  const modelPath = flag("modelo", process.env.RVM_MODEL_PATH ?? "");
  if (!modelPath) {
    console.error("Falta el modelo RVM — pasá --modelo <ruta.onnx> o configurá RVM_MODEL_PATH.");
    process.exit(1);
  }

  const workWidth = Number(flag("ancho", "1080"));
  const fps = Number(flag("fps", "30"));
  const segMinSec = Number(flag("seg-min", "5"));
  const segMaxSec = Number(flag("seg-max", "6"));
  const cutPositionFrac = Number(flag("corte", "0.5"));
  const blendBandFrac = Number(flag("difuminado", "0.15"));
  const backgroundPositionY = Number(flag("fondo-posicion-y", "0.5"));

  // Guards the easy-to-hit mistake of pointing the background folder at the
  // same folder the person video itself lives in — without this, the
  // person clip gets read back as one of its own backgrounds.
  const resolvedSource = path.resolve(source);
  const entries = await readdir(backgroundFolder);
  const allClipPaths = entries
    .filter((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(backgroundFolder, f));
  const clipPaths = allClipPaths.filter((p) => path.resolve(p) !== resolvedSource);
  if (clipPaths.length < allClipPaths.length) {
    console.log("atención: el video de la persona está dentro de la carpeta de fondos — se excluyó de las tomas de fondo.");
  }
  if (clipPaths.length === 0) {
    console.error(`no se encontró ningún video en "${backgroundFolder}"`);
    process.exit(1);
  }

  const probe = await probeAsset(source);

  const workDir = await mkdtemp(path.join(tmpdir(), "pulso-bg-multi-"));
  try {
    const perClipSec = Math.min(segMaxSec, Math.max(segMinSec, probe.durationSec / clipPaths.length));
    console.log(
      `armando el fondo con ${clipPaths.length} toma(s) de ~${perClipSec.toFixed(1)}s cada una ` +
        `(persona: ${probe.durationSec.toFixed(1)}s)…`,
    );
    const personFrameHeight = evenHeightForWidth(workWidth, probe.width, probe.height);
    const targetHeight = toEven(backgroundCoverHeight(personFrameHeight, cutPositionFrac, blendBandFrac));
    const reelPath = await buildBackgroundReel(
      clipPaths,
      probe.durationSec,
      workDir,
      workWidth,
      targetHeight,
      fps,
      segMinSec,
      segMaxSec,
      backgroundPositionY,
    );

    await replaceBackgroundSplit(
      source,
      reelPath,
      {
        cutPositionFrac,
        blendBandFrac,
        workWidth,
        outputFps: fps,
        modelPath,
        backgroundPositionY,
        onProgress: (done, total) => {
          if (done % 30 === 0 || done === total) console.log(`progreso: ${done}/${total} cuadros`);
        },
      },
      output,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  console.log(`listo: ${output}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
