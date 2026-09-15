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
import { assembleWordsFromDtwTokens, assignWordStarts, parseWavPcm16, rmsEnvelope, type DtwToken } from "./word-timing.js";

const run = promisify(execFile);

export interface TranscriptionRange {
  startSec: number;
  durationSec: number;
}

export interface TranscriptionProvider {
  readonly name: string;
  /** With `range`, transcribes only that stretch of the file; returned times are still relative to the whole file. */
  transcribe(audioAssetPath: string, language: string, range?: TranscriptionRange): Promise<TranscriptWord[]>;
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

const MIN_FALLBACK_SLOT_SEC = 0.2;

/**
 * whisper.cpp's `-sow` occasionally emits a RUN of consecutive words that
 * all share the exact same (often zero-width) start/end offsets — confirmed
 * on real AZ footage: a repeated retake ("Escríbenos al Whatsapp y te
 * diremos qué tipo...") had every word up to "de" collapse onto the same
 * instant, which later showed up as several zero-duration subtitle blocks
 * piled on one timestamp. This spreads such a run evenly across the gap
 * before the next word with a genuine timestamp, so nothing downstream
 * (subtitles, EDL trims) ever sees more than one word "at" the same time.
 * A run at the very end of the transcript (no following distinct word) gets
 * a fixed fallback slot width instead, since there's no real gap to spread it over.
 */
export function repairDegenerateTimestamps(words: readonly TranscriptWord[]): TranscriptWord[] {
  const repaired = words.map((w) => ({ ...w }));

  let i = 0;
  while (i < repaired.length) {
    let j = i;
    while (
      j + 1 < repaired.length &&
      repaired[j + 1]!.startSec === repaired[i]!.startSec &&
      repaired[j + 1]!.endSec === repaired[i]!.endSec
    ) {
      j++;
    }

    if (j > i) {
      const runLength = j - i + 1;
      const runStart = repaired[i]!.startSec;
      // The word right after the run can itself start exactly at runStart
      // (confirmed on real footage: "de" started at the same instant the
      // degenerate run did, but had its own real, later endSec) — in that
      // case its END is the better boundary, since its START gives no
      // separation at all.
      const next = j + 1 < repaired.length ? repaired[j + 1] : undefined;
      const boundary =
        next === undefined
          ? undefined
          : next.startSec > runStart
            ? next.startSec
            : next.endSec > runStart
              ? next.endSec
              : undefined;
      const span = boundary !== undefined ? boundary - runStart : runLength * MIN_FALLBACK_SLOT_SEC;
      const slot = span / runLength;
      for (let k = i; k <= j; k++) {
        repaired[k]!.startSec = runStart + slot * (k - i);
        repaired[k]!.endSec = runStart + slot * (k - i + 1);
      }
    }

    i = j + 1;
  }

  // Spreading a run can still leave it overlapping the word right after it
  // — confirmed on the same real case: "de" kept its own genuine (14.68,
  // 14.74) pair, which is exactly the window just handed to the run ending
  // right before it. A final monotonic pass is the general safety net: no
  // word may start before the previous one ends, and no word may have
  // zero/negative duration once pushed forward.
  for (let k = 1; k < repaired.length; k++) {
    if (repaired[k]!.startSec < repaired[k - 1]!.endSec) {
      repaired[k]!.startSec = repaired[k - 1]!.endSec;
    }
    if (repaired[k]!.endSec <= repaired[k]!.startSec) {
      repaired[k]!.endSec = repaired[k]!.startSec + 0.01;
    }
  }

  return repaired;
}

interface WhisperCppToken {
  text: string;
  offsets: { from: number; to: number };
  /** Centiseconds; -1 when DTW wasn't computed for this token. */
  t_dtw?: number;
}

interface WhisperCppOutput {
  transcription: Array<WhisperCppSegment & { words?: WhisperCppWord[]; tokens?: WhisperCppToken[] }>;
}

/**
 * Maps a whisper.cpp model filename to the `-dtw` preset naming its
 * alignment heads ("ggml-small.bin" → "small", "ggml-large-v3-turbo-q5_0.bin"
 * → "large.v3.turbo"). Undefined for a filename that doesn't follow the
 * standard naming — the caller falls back to the non-DTW timestamps then.
 */
export function dtwPresetForModel(modelPath: string): string | undefined {
  const match = /^ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3-turbo|large-v3)(\.en)?(?:[-.][^/]*)?\.bin$/i.exec(
    path.basename(modelPath),
  );
  if (!match) return undefined;
  return `${match[1]!.toLowerCase().replace(/-/g, ".")}${match[2]?.toLowerCase() ?? ""}`;
}

const ENVELOPE_WINDOW_SEC = 0.02;

/**
 * Shells out to the `whisper-cli` binary (Homebrew: `brew install
 * whisper-cpp`) the same way ffmpeg.ts shells out to ffmpeg.
 *
 * Word timing comes from DTW token alignment (`-dtw <preset>`, see
 * word-timing.ts for why and how starts are recovered). DTW needs flash
 * attention off (`-nfa`) — with it on, whisper.cpp silently reports every
 * token's t_dtw as -1. A model whose preset can't be determined falls back
 * to `-ml 1 -sow`, which spreads each segment's time across its words by
 * text length rather than by audio — noticeably less accurate at the start
 * of a take, but better than refusing to transcribe.
 */
export class WhisperCppProvider implements TranscriptionProvider {
  readonly name = "whisper-cpp";

  constructor(
    private readonly modelPath: string,
    private readonly binaryPath = "whisper-cli",
    /** null disables DTW; omitted infers the preset from the model filename. */
    private readonly dtwPreset: string | null = dtwPresetForModel(modelPath) ?? null,
  ) {}

  async transcribe(audioAssetPath: string, language: string, range?: TranscriptionRange): Promise<TranscriptWord[]> {
    const workDir = await mkdtemp(path.join(tmpdir(), "pulso-whisper-"));
    try {
      const wavPath = path.join(workDir, "audio.wav");
      await extractAudioForTranscription(audioAssetPath, wavPath, range);

      const outputBase = path.join(workDir, "out");
      const timingArgs = this.dtwPreset ? ["-dtw", this.dtwPreset, "-nfa", "-ojf"] : ["-ml", "1", "-sow", "-oj"];
      try {
        await run(
          this.binaryPath,
          ["-m", this.modelPath, "-f", wavPath, "-l", language, ...timingArgs, "-of", outputBase, "-np"],
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

      const parsed = JSON.parse(await readFile(`${outputBase}.json`, "utf8")) as WhisperCppOutput;
      const words = this.dtwPreset ? await wordsFromDtw(parsed, wavPath) : wordsFromSegments(parsed);

      if (words.length === 0) {
        throw new TranscriptionError(
          `whisper-cli no devolvió texto para "${audioAssetPath}" — ¿el archivo tiene audio audible?`,
        );
      }

      const offset = range?.startSec ?? 0;
      return repairDegenerateTimestamps(words).map((w) => ({
        ...w,
        startSec: w.startSec + offset,
        endSec: w.endSec + offset,
      }));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

async function wordsFromDtw(parsed: WhisperCppOutput, wavPath: string): Promise<TranscriptWord[]> {
  const tokens: DtwToken[] = [];
  for (const segment of parsed.transcription) {
    for (const token of segment.tokens ?? []) {
      // Special tokens ("[_BEG_]", "[_TT_150]") and whisper's ">>" speaker-change marker carry no speech.
      if (token.text.startsWith("[_") || token.text.trim() === ">>") continue;
      const endSec = token.t_dtw !== undefined && token.t_dtw >= 0 ? token.t_dtw / 100 : token.offsets.to / 1000;
      tokens.push({ text: token.text, endSec });
    }
  }

  const wordsWithEnds = assembleWordsFromDtwTokens(tokens);
  const wav = parseWavPcm16(await readFile(wavPath));
  const envelope = wav ? rmsEnvelope(wav, ENVELOPE_WINDOW_SEC) : [];
  return assignWordStarts(wordsWithEnds, envelope, ENVELOPE_WINDOW_SEC);
}

/** Legacy `-ml 1 -sow` output: each SEGMENT is already one word (or `words`, if a future whisper.cpp populates it). */
function wordsFromSegments(parsed: WhisperCppOutput): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const segment of parsed.transcription) {
    const source = segment.words && segment.words.length > 0 ? segment.words : [segment];
    for (const w of source) {
      const text = w.text.trim();
      if (!text) continue;
      words.push({ text, startSec: w.offsets.from / 1000, endSec: w.offsets.to / 1000 });
    }
  }
  return words;
}

/**
 * Picks whichever provider is configured (today: only whisper.cpp — Fase 0
 * decided against a paid API). WHISPER_MODEL_PATH points at a .bin
 * downloaded from https://huggingface.co/ggerganov/whisper.cpp — not
 * shipped in the repo (hundreds of MB). WHISPER_DTW_PRESET overrides the
 * preset inferred from the model filename; "off" disables DTW.
 */
export function getConfiguredProvider(): TranscriptionProvider {
  const modelPath = process.env.WHISPER_MODEL_PATH;
  if (!modelPath) {
    throw new TranscriptionError(
      "WHISPER_MODEL_PATH no está configurado. Descargá un modelo (p. ej. ggml-base.bin) desde " +
        "https://huggingface.co/ggerganov/whisper.cpp y apuntá la variable de entorno a ese archivo.",
    );
  }
  const presetOverride = process.env.WHISPER_DTW_PRESET?.trim();
  const dtwPreset = presetOverride === "off" ? null : presetOverride || (dtwPresetForModel(modelPath) ?? null);
  return new WhisperCppProvider(modelPath, process.env.WHISPER_CLI_PATH, dtwPreset);
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
