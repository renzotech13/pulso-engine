// 2.7: normalizes the voice track (loudnorm) and, when the project has a
// music file, mixes it in underneath with ducking (sidechaincompress — the
// music itself gets quieter while there's speech, not just permanently
// lowered) and fades. Always produces a normalized audio track, even with
// no music at all, since loudnorm is part of "audio normalizado" in the
// acceptance criteria regardless of whether music is involved.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "@pulso/shared/errors";
import type { Preset } from "./preset.js";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export class AudioMixError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "AUDIO_MIX_ERROR", cause);
    this.name = "AudioMixError";
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

export interface LoudnessTarget {
  /** EBU R128 integrated loudness target, LUFS. Ticket default: -14. */
  targetLufs?: number;
}

/**
 * Mixes `voicePath`'s audio with an optional background track, producing a
 * single normalized WAV at `outputWavPath`. With no `musicPath`, this is
 * just the loudnorm pass — the ticket's "audio normalizado" criterion
 * applies to every render, music or not.
 */
export async function mixAudio(
  voicePath: string,
  musicPath: string | undefined,
  musicPreset: Preset["musica"],
  durationSec: number,
  outputWavPath: string,
  loudness: LoudnessTarget = {},
): Promise<void> {
  const targetLufs = loudness.targetLufs ?? -14;

  if (!musicPath) {
    try {
      await run("ffmpeg", ["-y", "-i", voicePath, "-af", `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`, "-vn", outputWavPath], {
        maxBuffer: MAX_BUFFER,
      });
    } catch (err) {
      if (isEnoent(err)) throw new AudioMixError('"ffmpeg" no está instalado o no está en el PATH.', err);
      throw new AudioMixError("no se pudo normalizar el audio de la voz", err);
    }
    return;
  }

  // Sidechaincompress needs the voice as its trigger ("sidechain") input
  // and the music as the signal actually being compressed — music drops in
  // volume only while there's voice loud enough to trigger it, which is
  // real ducking rather than a flat volume offset for the whole clip.
  // `aloop=loop=-1` repeats the music indefinitely; `atrim` after the mix
  // cuts everything to the video's exact length regardless of which input
  // (voice or looped music) happened to be longer.
  const musicVolume = 10 ** (musicPreset.volumenDb / 20);
  const fadeOutStart = Math.max(0, durationSec - musicPreset.fadeOutSeg);

  const filterComplex = [
    `[0:a]loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[voice]`,
    `[1:a]aloop=loop=-1:size=2e9,volume=${musicVolume},afade=t=in:st=0:d=${musicPreset.fadeInSeg},afade=t=out:st=${fadeOutStart}:d=${musicPreset.fadeOutSeg}[musicraw]`,
    musicPreset.ducking
      ? `[musicraw][voice]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[music]`
      : `[musicraw]anull[music]`,
    `[voice][music]amix=inputs=2:duration=first:dropout_transition=0[mixed]`,
    `[mixed]atrim=0:${durationSec}[out]`,
  ].join(";");

  try {
    await run(
      "ffmpeg",
      ["-y", "-i", voicePath, "-i", musicPath, "-filter_complex", filterComplex, "-map", "[out]", outputWavPath],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    if (isEnoent(err)) throw new AudioMixError('"ffmpeg" no está instalado o no está en el PATH.', err);
    throw new AudioMixError("no se pudo mezclar la música con la voz", err);
  }
}
