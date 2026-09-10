// TranscriptionProvider: the pipeline talks to this interface only, never
// to a specific engine. Swapping whisper.cpp for an API later (ElevenLabs,
// Deepgram, whatever) means writing one more class here, nothing else in
// the pipeline changes. See docs/PRESETS.md... (README, once written) for
// how to add one.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AppError } from "@pulso/shared/errors";
import { extractAudioForTranscription } from "./ffmpeg.js";
import type { AudioAnalysis, TranscriptWord } from "./types.js";

const run = promisify(execFile);

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(audioAssetPath: string, language: string): Promise<TranscriptWord[]>;
}

export class TranscriptionError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "TRANSCRIPTION_ERROR", cause);
    this.name = "TranscriptionError";
  }
}

interface WhisperCppWord {
  text: string;
  // whisper.cpp's JSON reports timestamps as both a formatted string
  // ("00:00:01,234") and offsets in centiseconds under `t0`/`t1` — the
  // centisecond form is used since it needs no time-string parsing.
  offsets: { from: number; to: number };
}

interface WhisperCppSegment {
  text: string;
  offsets: { from: number; to: number };
}

interface WhisperCppOutput {
  transcription: Array<WhisperCppSegment & { words?: WhisperCppWord[] }>;
}

/**
 * Shells out to the `whisper-cli` binary (Homebrew: `brew install
 * whisper-cpp`) the same way ffmpeg.ts shells out to ffmpeg. Word-level
 * timestamps come from `-ml 1 -sow` (split on word, cap each segment at 1
 * character — which in practice means "one word," since a segment can't be
 * split mid-word): the documented whisper.cpp trick for per-word output,
 * not a made-up flag.
 */
export class WhisperCppProvider implements TranscriptionProvider {
  readonly name = "whisper-cpp";

  constructor(
    private readonly modelPath: string,
    private readonly binaryPath = "whisper-cli",
  ) {}

  async transcribe(audioAssetPath: string, language: string): Promise<TranscriptWord[]> {
    const workDir = await mkdtemp(path.join(tmpdir(), "pulso-whisper-"));
    try {
      const wavPath = path.join(workDir, "audio.wav");
      await extractAudioForTranscription(audioAssetPath, wavPath);

      const outputBase = path.join(workDir, "out");
      try {
        await run(
          this.binaryPath,
          [
            "-m", this.modelPath,
            "-f", wavPath,
            "-l", language,
            "-ml", "1",
            "-sow",
            "-oj",
            "-of", outputBase,
            "-np",
          ],
          { maxBuffer: 64 * 1024 * 1024 },
        );
      } catch (err) {
        if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
          throw new TranscriptionError(
            `no se encontró el binario "${this.binaryPath}". Instalalo con "brew install whisper-cpp".`,
            err,
          );
        }
        throw new TranscriptionError(`whisper-cli falló transcribiendo "${audioAssetPath}"`, err);
      }

      const raw = await readFile(`${outputBase}.json`, "utf8");
      const parsed = JSON.parse(raw) as WhisperCppOutput;

      // -ml 1 -sow makes each SEGMENT already one word; the `words` array
      // (from -owts, not requested here) is a separate karaoke-script
      // feature this doesn't need. Falls back to `words` if a future
      // whisper.cpp version populates it anyway, since that'd be strictly
      // more precise than segment-as-word.
      const words: TranscriptWord[] = [];
      for (const segment of parsed.transcription) {
        const source = segment.words && segment.words.length > 0 ? segment.words : [segment];
        for (const w of source) {
          const text = w.text.trim();
          if (!text) continue;
          words.push({
            text,
            startSec: w.offsets.from / 1000,
            endSec: w.offsets.to / 1000,
          });
        }
      }

      if (words.length === 0) {
        throw new TranscriptionError(
          `whisper-cli no devolvió texto para "${audioAssetPath}" — ¿el archivo tiene audio audible?`,
        );
      }

      return words;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * Picks whichever provider is configured (today: only whisper.cpp — Fase 0
 * decided against a paid API). WHISPER_MODEL_PATH points at a .bin
 * downloaded from https://huggingface.co/ggerganov/whisper.cpp — not
 * shipped in the repo (hundreds of MB).
 */
export function getConfiguredProvider(): TranscriptionProvider {
  const modelPath = process.env.WHISPER_MODEL_PATH;
  if (!modelPath) {
    throw new TranscriptionError(
      "WHISPER_MODEL_PATH no está configurado. Descargá un modelo (p. ej. ggml-base.bin) desde " +
        "https://huggingface.co/ggerganov/whisper.cpp y apuntá la variable de entorno a ese archivo.",
    );
  }
  return new WhisperCppProvider(modelPath, process.env.WHISPER_CLI_PATH);
}

export async function analyzeAudio(
  provider: TranscriptionProvider,
  assetPath: string,
  language: string,
  silences: AudioAnalysis["silences"],
): Promise<AudioAnalysis> {
  const words = await provider.transcribe(assetPath, language);
  return { assetPath, provider: provider.name, language, words, silences };
}
