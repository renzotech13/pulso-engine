// 2.4: assigns raw clips to the script they belong to, finds which parts of
// each clip are actual usable takes (vs. false starts, filler, repeated
// attempts), and orders the result into an EDL that follows the SCRIPT's
// order — not the files' chronological order, per the spec.
//
// Deliberately dependency-free (no fuzzy-matching library): word n-gram
// Dice similarity is simple enough to unit-test exhaustively and good
// enough for "does this clip's speech resemble this script," which is a
// much coarser question than "align these two strings precisely."

import type { AudioAnalysis, Edl, EdlSegment, ScriptVideo, Silence, TranscriptWord } from "./types.js";

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(" ") : [];
}

function ngrams(tokens: string[], n: number): Set<string> {
  if (tokens.length < n) return new Set(tokens.length > 0 ? [tokens.join(" ")] : []);
  const result = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) result.add(tokens.slice(i, i + n).join(" "));
  return result;
}

/** 0 (nothing in common) to 1 (identical bag of n-grams). */
export function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

export function textSimilarity(a: string, b: string, n = 2): number {
  return diceSimilarity(ngrams(tokenize(a), n), ngrams(tokenize(b), n));
}

/**
 * 0 to 1: what fraction of the SMALLER set's n-grams also appear in the
 * larger one. Unlike Dice (symmetric, penalizes any length difference),
 * this says a short phrase that is fully contained in a longer one scores
 * near 1 — exactly the shape of "a false start that got cut short, then
 * the same line said again in full": the short attempt's words are a
 * subset of the complete take's words, even though the take has plenty of
 * extra words the short attempt never reached.
 */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  let shared = 0;
  for (const gram of smaller) if (larger.has(gram)) shared++;
  return shared / smaller.size;
}

function textContainment(a: string, b: string, n = 2): number {
  return containment(ngrams(tokenize(a), n), ngrams(tokenize(b), n));
}

// --- Asignación de archivos a guiones ---------------------------------------

export interface AssetAssignment {
  scriptVideoId: string | undefined; // undefined = no script matched well enough
  score: number;
}

/**
 * One independent decision per asset — never lets a strong match on one
 * script steal an asset that belongs, more weakly, to a DIFFERENT one it
 * simply hasn't been compared against yet. A filename hint (the script's id
 * appearing in the asset's path) adds a flat bonus rather than deciding
 * things outright, since a rename would otherwise silently break it.
 */
export function assignAssetToScript(
  analysis: AudioAnalysis,
  scripts: readonly ScriptVideo[],
  minScore = 0.08,
): AssetAssignment {
  const transcriptText = analysis.words.map((w) => w.text).join(" ");
  const filename = analysis.assetPath.toLowerCase();

  let best: AssetAssignment = { scriptVideoId: undefined, score: 0 };
  for (const script of scripts) {
    let score = textSimilarity(transcriptText, script.guion);
    if (filename.includes(script.id.toLowerCase())) score += 0.15;
    if (score > best.score) best = { scriptVideoId: script.id, score };
  }

  return best.score >= minScore ? best : { scriptVideoId: undefined, score: best.score };
}

// --- Detección de tomas dentro de un archivo --------------------------------

export interface SpeechRun {
  words: TranscriptWord[];
  startSec: number;
  endSec: number;
}

/**
 * Splits a word list into runs of continuous speech, breaking wherever a
 * detected silence (or just a gap between consecutive words' timestamps —
 * silencedetect's threshold can miss a shorter pause) falls between them.
 * This is what turns "one long transcript" into "candidate takes."
 */
export function segmentIntoRuns(words: readonly TranscriptWord[], silences: readonly Silence[]): SpeechRun[] {
  if (words.length === 0) return [];

  const breaksAt = (gapStart: number, gapEnd: number): boolean =>
    silences.some((s) => s.startSec < gapEnd && s.endSec > gapStart);

  const runs: SpeechRun[] = [];
  let current: TranscriptWord[] = [words[0]!];

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]!;
    const word = words[i]!;
    const gap = word.startSec - prev.endSec;
    if (gap > 2 || breaksAt(prev.endSec, word.startSec)) {
      runs.push(toRun(current));
      current = [];
    }
    current.push(word);
  }
  runs.push(toRun(current));
  return runs;
}

function toRun(words: TranscriptWord[]): SpeechRun {
  return { words, startSec: words[0]!.startSec, endSec: words[words.length - 1]!.endSec };
}

export interface BuildEdlOptions {
  /** Below this similarity to the script, a run is off-script chatter/filler — dropped. */
  minRunScore?: number;
  /**
   * Containment threshold (see `containment` above): when the SHORTER of
   * two runs has at least this fraction of its words inside the longer
   * one, they're the same line — one a cut-short or redone attempt at the
   * other — and only the chronologically later run is kept.
   */
  duplicateThreshold?: number;
  /** Silence padding kept at each cut so it doesn't sound abrupt. */
  marginSec?: number;
}

// Capping (rather than removing) the silence BETWEEN consecutive segments
// once they're concatenated is a render-time concern (2.8, render.ts) —
// each EDL segment here is already a single continuous run with no long
// silence left inside it (segmentIntoRuns breaks runs at every detected
// silence), so there's nothing left to cap at this stage.
const DEFAULT_OPTIONS: Required<BuildEdlOptions> = {
  minRunScore: 0.15,
  duplicateThreshold: 0.7,
  marginSec: 0.2,
};

interface ScoredRun {
  assetPath: string;
  run: SpeechRun;
  scriptPosition: number; // token index of the best-matching window in the script
  score: number;
}

/** Where in the script's token stream this run's text best matches — used to order segments by script position, not recording order. */
function bestScriptPosition(runText: string, scriptTokens: string[]): { position: number; score: number } {
  const runTokens = tokenize(runText);
  if (runTokens.length === 0 || scriptTokens.length === 0) return { position: 0, score: 0 };

  const runGrams = ngrams(runTokens, 2);
  const windowSize = Math.max(runTokens.length, 3);

  let best = { position: 0, score: 0 };
  for (let i = 0; i <= Math.max(0, scriptTokens.length - 1); i += 1) {
    const window = scriptTokens.slice(i, i + windowSize);
    const score = diceSimilarity(runGrams, ngrams(window, 2));
    if (score > best.score) best = { position: i, score };
  }
  return best;
}

/**
 * Builds the EDL for one script from every clip assigned to it. Runs are
 * scored against the script to drop filler, deduplicated to keep only the
 * last complete take of a repeated line, then ordered by where their
 * content sits in the script — a script can legitimately be recorded
 * out of order across takes, and the output should read the script anyway.
 */
export function buildEdl(
  scriptVideo: ScriptVideo,
  assetAnalyses: readonly AudioAnalysis[],
  options: BuildEdlOptions = {},
): Edl {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const scriptTokens = tokenize(scriptVideo.guion);

  const candidates: ScoredRun[] = [];
  for (const analysis of assetAnalyses) {
    const runs = segmentIntoRuns(analysis.words, analysis.silences);
    for (const run of runs) {
      const text = run.words.map((w) => w.text).join(" ");
      const { position, score } = bestScriptPosition(text, scriptTokens);
      if (score >= opts.minRunScore) {
        candidates.push({ assetPath: analysis.assetPath, run, scriptPosition: position, score });
      }
    }
  }

  // Retakes: two runs are "the same line" if their OWN texts are similar to
  // each other, not just both similar to the script (a script line can
  // legitimately repeat words across genuinely different lines). Later
  // recording (by array order, which callers pass chronologically) wins.
  const kept: ScoredRun[] = [];
  for (const candidate of candidates) {
    const candidateText = candidate.run.words.map((w) => w.text).join(" ");
    const duplicateIndex = kept.findIndex(
      (existing) =>
        textContainment(candidateText, existing.run.words.map((w) => w.text).join(" ")) >= opts.duplicateThreshold,
    );
    if (duplicateIndex === -1) {
      kept.push(candidate);
    } else {
      kept[duplicateIndex] = candidate; // this one was recorded later — replace, don't append
    }
  }

  kept.sort((a, b) => a.scriptPosition - b.scriptPosition);

  const segmentos: EdlSegment[] = kept.map((c) => ({
    archivo: c.assetPath,
    inicio: Math.max(0, c.run.startSec - opts.marginSec),
    fin: c.run.endSec + opts.marginSec,
    lineaGuion: c.run.words.map((w) => w.text).join(" "),
    videoId: scriptVideo.id,
  }));

  return { videoId: scriptVideo.id, segmentos };
}
