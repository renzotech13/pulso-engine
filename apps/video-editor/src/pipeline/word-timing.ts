// Word timestamps from whisper.cpp's DTW token alignment, plus an acoustic
// refinement of where each word STARTS.
//
// Why not `-ml 1 -sow` (what transcription used before): that mode splits a
// decoded segment into per-word "segments" by distributing the segment's
// time range across its text, not by listening — confirmed on real AZ
// footage to be off by whole seconds right where it matters most, the start
// of a take: ADS-01-ESCENA-04 put "Soy" at 0.00s when the director's "...uno,
// acción" actually runs until ~1.65s and "Soy" is spoken at ~2.05s;
// ADS-01-ESCENA-03-PARTE-01 put "Tu" at 0.00s when it's spoken at ~1.10s.
// DTW token timestamps (`-dtw <preset>`) landed within ~0.1s of the real
// energy envelope on both.
//
// DTW gives each token a single instant that tracks the token's END (checked
// against the energy envelope: "soy" 2.40 after a burst ending 2.30, "DNI"
// 3.80 exactly where energy drops). A word's START is therefore recovered
// from the audio itself: the end of the last real pause between the previous
// word and this one, or the previous word's end when there's no pause.

import type { TranscriptWord } from "./types.js";

export interface DtwToken {
  /** Raw token text as whisper emitted it — a leading space marks the start of a new word. */
  text: string;
  endSec: number;
}

export interface WordWithEnd {
  text: string;
  endSec: number;
  /**
   * The earliest the word can plausibly start, from its own opening token:
   * that token's end minus how long its letters can take to say. Stops a
   * word from swallowing untranscribed speech before it (whisper routinely
   * drops a director's "tres, dos, uno, va" from the text) — the pause-based
   * start alone can't, when the location audio has no pause to find.
   */
  onsetBoundSec?: number;
}

const OPENING_PUNCTUATION_ONLY = /^[¡¿"'(«[“‘]+$/u;
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

/**
 * Merges subword tokens (" Alex" + "is") into words. Punctuation never moves
 * a word's end — a trailing "." token can sit a whole pause after the word
 * it closes (" acción" 2.02 → "." 2.48 on real audio) — and opening
 * punctuation ("¡", "¿") is carried into the word that follows it.
 */
export function assembleWordsFromDtwTokens(tokens: readonly DtwToken[]): WordWithEnd[] {
  const words: Array<{ text: string; tokens: DtwToken[] }> = [];
  let pendingPrefix = "";

  for (const token of tokens) {
    const trimmed = token.text.trim();
    if (!trimmed) continue;

    if (PUNCTUATION_ONLY.test(trimmed)) {
      const last = words.at(-1);
      if (OPENING_PUNCTUATION_ONLY.test(trimmed) || !last) pendingPrefix += trimmed;
      else last.text += trimmed;
      continue;
    }

    const last = words.at(-1);
    const startsNewWord = token.text.startsWith(" ") || !last || pendingPrefix !== "";
    if (startsNewWord) {
      words.push({ text: pendingPrefix + trimmed, tokens: [{ text: trimmed, endSec: token.endSec }] });
      pendingPrefix = "";
    } else {
      last.text += trimmed;
      last.tokens.push({ text: trimmed, endSec: token.endSec });
    }
  }

  const last = words.at(-1);
  if (pendingPrefix && last) last.text += pendingPrefix;

  return words.map(({ text, tokens: wordTokens }) => ({
    text,
    endSec: wordTokens.at(-1)!.endSec,
    onsetBoundSec: onsetBound(wordTokens),
  }));
}

// A word's first token landing this far before its second is a DTW outlier,
// not a slow syllable — confirmed on real audio: " Es"@9.94 then "cr"@14.92
// for one "Escríbenos".
const TOKEN_OUTLIER_GAP_SEC = 0.6;
const SEC_PER_LETTER = 0.06;
const ONSET_BASE_SEC = 0.12;
const MAX_OPENING_SEC = 0.45;

function speakingTimeFor(text: string): number {
  const letters = text.normalize("NFD").replace(/[^\p{L}\p{N}]/gu, "").length;
  return Math.min(MAX_OPENING_SEC, ONSET_BASE_SEC + SEC_PER_LETTER * letters);
}

function onsetBound(wordTokens: readonly DtwToken[]): number {
  const anchor =
    wordTokens.length > 1 && wordTokens[1]!.endSec - wordTokens[0]!.endSec > TOKEN_OUTLIER_GAP_SEC ? 1 : 0;
  const openingText = wordTokens
    .slice(0, anchor + 1)
    .map((t) => t.text)
    .join("");
  return wordTokens[anchor]!.endSec - speakingTimeFor(openingText);
}

export interface WavPcm {
  sampleRate: number;
  samples: Int16Array;
}

/** Minimal RIFF walk for the 16-bit PCM WAV extractAudioForTranscription writes — tolerant of extra chunks (e.g. LIST). */
export function parseWavPcm16(buffer: Buffer): WavPcm | undefined {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return undefined;
  }

  let offset = 12;
  let sampleRate: number | undefined;
  let dataStart: number | undefined;
  let dataLength: number | undefined;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    if (chunkId === "fmt " && bodyStart + 8 <= buffer.length) sampleRate = buffer.readUInt32LE(bodyStart + 4);
    if (chunkId === "data") {
      dataStart = bodyStart;
      dataLength = chunkSize;
    }
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }
  if (sampleRate === undefined || dataStart === undefined || dataLength === undefined) return undefined;

  const sampleCount = Math.floor(Math.min(dataLength, buffer.length - dataStart) / 2);
  if (sampleCount <= 0) return undefined;
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) samples[i] = buffer.readInt16LE(dataStart + i * 2);
  return { sampleRate, samples };
}

export function rmsEnvelope(wav: WavPcm, windowSec: number): number[] {
  const windowSize = Math.max(1, Math.round(windowSec * wav.sampleRate));
  const envelope: number[] = [];
  for (let start = 0; start + windowSize <= wav.samples.length; start += windowSize) {
    let sumSquares = 0;
    for (let i = start; i < start + windowSize; i++) {
      const sample = wav.samples[i]! / 32768;
      sumSquares += sample * sample;
    }
    envelope.push(Math.sqrt(sumSquares / windowSize));
  }
  return envelope;
}

/** A window this far below the loudest point between two words counts as silence. */
const QUIET_RATIO = 0.4;
// Long enough to skip the closure inside a word ("a-t-endemos", "ac-ción":
// ~50-100ms on real audio), short enough to catch a real gap between words
// (the pause before "Soy" and "Sigues" was ~300ms on the AZ takes).
const MIN_PAUSE_SEC = 0.15;
const MIN_WORD_SEC = 0.02;

/**
 * Gives each word a start: the latest of (a) the previous word's end, (b) the
 * end of the LAST pause (≥ MIN_PAUSE_SEC) before this word's end that some
 * speech follows, and (c) the word's own onset bound (see WordWithEnd). (b)
 * alone fails on location audio with no silence at all; (c) alone is only a
 * letter-count estimate — where a real pause is found, it wins.
 */
export function assignWordStarts(
  words: readonly WordWithEnd[],
  envelope: readonly number[],
  windowSec: number,
): TranscriptWord[] {
  const minPauseWindows = Math.max(1, Math.round(MIN_PAUSE_SEC / windowSec));
  const result: TranscriptWord[] = [];

  for (const word of words) {
    const prevEnd = result.at(-1)?.endSec ?? 0;
    const endSec = Math.max(word.endSec, prevEnd + MIN_WORD_SEC);

    const from = Math.max(0, Math.floor(prevEnd / windowSec));
    const to = Math.min(envelope.length, Math.ceil(endSec / windowSec));
    const window = envelope.slice(from, to);

    let startSec = prevEnd;
    if (window.length > 0) {
      const threshold = Math.max(...window) * QUIET_RATIO;
      let runStart = -1;
      for (let i = 0; i < window.length; i++) {
        const quiet = window[i]! < threshold;
        if (quiet && runStart === -1) runStart = i;
        if (!quiet && runStart !== -1) {
          // Loud window right after a long-enough quiet run: the word (or a
          // later syllable of it) resumes here. Keep scanning — the LAST such
          // pause is the one directly before this word.
          if (i - runStart >= minPauseWindows) startSec = (from + i) * windowSec;
          runStart = -1;
        }
      }
    }

    startSec = Math.max(startSec, prevEnd, word.onsetBoundSec ?? prevEnd);
    startSec = Math.min(startSec, endSec - MIN_WORD_SEC);
    result.push({ text: word.text, startSec, endSec });
  }

  return result;
}
