// Every ffmpeg/ffprobe invocation in the pipeline, in one place. Always the
// system binary via execFile with an argument array — never a shell string,
// since file paths here can come from an uploaded filename.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "@pulso/shared/errors";
import type { AssetProbe, Silence } from "./types.js";

const run = promisify(execFile);
// ffprobe/ffmpeg can sit for a long time on a multi-GB file; generous but
// not infinite, so a genuinely stuck process still surfaces as an error
// instead of hanging the whole pipeline run.
const MAX_BUFFER = 64 * 1024 * 1024;

export class FfmpegNotFoundError extends AppError {
  constructor(binary: "ffmpeg" | "ffprobe", cause?: unknown) {
    super(
      `"${binary}" no está instalado o no está en el PATH. Instálalo con "brew install ffmpeg" y volvé a intentar.`,
      "FFMPEG_NOT_FOUND",
      cause,
    );
    this.name = "FfmpegNotFoundError";
  }
}

export class InvalidMediaError extends AppError {
  constructor(path: string, reason: string, cause?: unknown) {
    super(`"${path}" no es un archivo de video válido: ${reason}`, "INVALID_MEDIA", cause);
    this.name = "InvalidMediaError";
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

interface FfprobeStream {
  codec_type: "video" | "audio" | "subtitle" | "data";
  codec_name: string;
  width?: number;
  height?: number;
  // ffprobe reports frame rate as a "num/den" fraction (e.g. "30000/1001"),
  // never a decimal, because it's exact even for non-integer rates like
  // 29.97 — parsed in parseFps below rather than trusted as a plain number.
  r_frame_rate?: string;
}

interface FfprobeFormat {
  duration?: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

function parseFps(rFrameRate: string | undefined): number {
  if (!rFrameRate) return 0;
  const [num, den] = rFrameRate.split("/").map(Number);
  if (!num || !den) return 0;
  return num / den;
}

/**
 * Validates one file and extracts everything later stages need (2.1).
 * Never throws on a merely-unusual file — a corrupt file or one with no
 * audio track is a normal, expected outcome the caller should show the
 * user, not a bug, so those come back as InvalidMediaError with a message
 * meant to be shown as-is.
 */
export async function probeAsset(path: string): Promise<AssetProbe> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
      { maxBuffer: MAX_BUFFER },
    ));
  } catch (err) {
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffprobe", err);
    throw new InvalidMediaError(path, "el archivo está corrupto o no es un video reconocible", err);
  }

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch (err) {
    throw new InvalidMediaError(path, "ffprobe no devolvió metadata legible", err);
  }

  const videoStream = parsed.streams.find((s) => s.codec_type === "video");
  const audioStream = parsed.streams.find((s) => s.codec_type === "audio");
  const durationSec = Number(parsed.format.duration);

  if (!videoStream) throw new InvalidMediaError(path, "no tiene pista de video");
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new InvalidMediaError(path, "no se pudo determinar la duración");
  }
  if (!videoStream.width || !videoStream.height) {
    throw new InvalidMediaError(path, "no se pudo determinar la resolución");
  }

  return {
    path,
    durationSec,
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream?.codec_name ?? null,
    width: videoStream.width,
    height: videoStream.height,
    fps: parseFps(videoStream.r_frame_rate),
    hasAudio: Boolean(audioStream),
  };
}

export interface SilenceDetectOptions {
  /** dB threshold below which audio counts as silence. ffmpeg default is -60dB; -30dB is more forgiving of room tone. */
  noiseThresholdDb?: number;
  /** Minimum silence length to report, in seconds. */
  minDurationSec?: number;
}

/**
 * Runs `ffmpeg -af silencedetect` and parses its stderr (silencedetect
 * writes results to stderr as log lines, never stdout — this is standard
 * ffmpeg filter behavior, not a mistake).
 */
export async function detectSilences(path: string, options: SilenceDetectOptions = {}): Promise<Silence[]> {
  const noiseThresholdDb = options.noiseThresholdDb ?? -30;
  const minDurationSec = options.minDurationSec ?? 0.3;

  let stderr: string;
  try {
    ({ stderr } = await run(
      "ffmpeg",
      [
        "-i", path,
        "-af", `silencedetect=noise=${noiseThresholdDb}dB:d=${minDurationSec}`,
        "-f", "null",
        "-",
      ],
      { maxBuffer: MAX_BUFFER },
    ));
  } catch (err) {
    // ffmpeg with `-f null -` exits non-zero for reasons unrelated to
    // silencedetect (e.g. a truly silent whole-file edge case) — the actual
    // detection lines are still in stderr, which execFile attaches to the
    // error object, so recover them rather than treating this as fatal.
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffmpeg", err);
    stderr = (err as { stderr?: string }).stderr ?? "";
    if (!stderr.includes("silence_start") && !stderr.includes("silencedetect")) {
      throw new InvalidMediaError(path, "no se pudo analizar el audio para detectar silencios", err);
    }
  }

  const silences: Silence[] = [];
  let pendingStart: number | undefined;

  for (const line of stderr.split("\n")) {
    const startMatch = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (endMatch && pendingStart !== undefined) {
      silences.push({ startSec: Math.max(0, pendingStart), endSec: Number(endMatch[1]) });
      pendingStart = undefined;
    }
  }

  return silences;
}

/**
 * Extracts the audio track as a 16kHz mono WAV — the format every local
 * speech model (whisper.cpp included) expects, and much smaller than
 * shipping the source video into the transcription step.
 */
export async function extractAudioForTranscription(path: string, outputWavPath: string): Promise<void> {
  try {
    await run(
      "ffmpeg",
      ["-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputWavPath],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffmpeg", err);
    throw new InvalidMediaError(path, "no se pudo extraer el audio", err);
  }
}

/**
 * Extracts the audio track at 48kHz (DeepFilterNet's native rate) keeping
 * the source's own channel count — unlike extractAudioForTranscription,
 * this feeds a denoiser meant to improve the FINAL voice track, not a
 * transcription-only throwaway copy, so it doesn't downsample to 16kHz mono.
 */
export async function extractAudioForDenoise(path: string, outputWavPath: string): Promise<void> {
  try {
    await run("ffmpeg", ["-y", "-i", path, "-vn", "-ar", "48000", "-c:a", "pcm_s16le", outputWavPath], {
      maxBuffer: MAX_BUFFER,
    });
  } catch (err) {
    if (isEnoent(err)) throw new FfmpegNotFoundError("ffmpeg", err);
    throw new InvalidMediaError(path, "no se pudo extraer el audio", err);
  }
}
