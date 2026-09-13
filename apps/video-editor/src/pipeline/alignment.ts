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

/** Splits on whitespace only — keeps original casing/accents/punctuation, for when the matched text needs to be DISPLAYED, not just scored. */
export function splitOriginalWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function ngrams(tokens: string[], n: number): Set<string> {
  if (tokens.length < n) return new Set(tokens.length > 0 ? [tokens.join(" ")] : []);
  const result = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) result.add(tokens.slice(i, i + n).join(" "));
  return result;
}

/**
 * Classic Needleman-Wunsch global alignment between two token sequences —
 * used to map each TRANSCRIPT word onto its corresponding SCRIPT word (see
 * subtitles.ts) without just linearly compressing one length onto the
 * other. A naive proportional mapping smears a single divergence (an
 * acronym whisper.cpp heard as two words, "RUC" → "aría uce") across the
 * WHOLE segment via rounding, duplicating an unrelated word near wherever
 * the arithmetic happens to land — confirmed on real transcribed audio: it
 * duplicated the segment's very FIRST word even though the true divergence
 * was several words in. Real alignment costs one substitution + one
 * deletion right at the two words that actually diverged and leaves
 * everything before and after them exactly 1:1.
 *
 * Returns, for each index in `a` (the transcript), the aligned index in
 * `b` (the script) — or null when `a[i]` has no script counterpart at all
 * (whisper transcribed a word the script doesn't have; rare, since these
 * words already passed a script-similarity threshold to get this far).
 */
export function alignWordSequences(a: readonly string[], b: readonly string[]): Array<number | null> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = edit distance between a[0..i) and b[0..j).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i]![0] = i;
  for (let j = 0; j <= m; j++) dp[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j - 1]! + cost, // match or substitute
        dp[i - 1]![j]! + 1, // delete a[i-1] (no script counterpart)
        dp[i]![j - 1]! + 1, // insert b[j-1] (script word never said — skip it)
      );
    }
  }

  // Backtrack from (n, m) to (0, 0), recovering which move produced each
  // cell — same three cases as the recurrence above, preferring a
  // match/substitute (diagonal) whenever it's tied with an insert/delete,
  // since that's the one that actually assigns a[i-1] to a script word.
  const alignment: Array<number | null> = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const cost = i > 0 && j > 0 && a[i - 1] === b[j - 1] ? 0 : 1;
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + cost) {
      alignment[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      alignment[i - 1] = null; // a[i-1] deleted — no script word for it
      i--;
    } else {
      j--; // b[j-1] inserted — a script word with no spoken counterpart
    }
  }

  return alignment;
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
 *
 * Scored with containment, not symmetric Dice: one raw take is normally a
 * short excerpt of ONE scene, while a script can legitimately bundle several
 * scenes into a single `guion` (a whole ad, several lines long). Dice
 * penalizes that size gap directly — a perfectly-matching 9-word clip
 * against an 80-word multi-scene script scores low no matter how clean the
 * match is, just because the script is so much longer than the clip.
 * Confirmed on real footage: a take whose entire transcript was a clean
 * excerpt of its script still scored under the old default `minScore`
 * (0.08) via Dice, and was silently dropped from the final cut. Containment
 * asks the right question instead — "is the SHORT side's content really in
 * there" — which is exactly what "does this take belong to this script"
 * means.
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
    let score = textContainment(transcriptText, script.guion);
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

const COUNTDOWN_WORDS = new Set(["0", "1", "2", "3", "4", "5", "cero", "uno", "dos", "tres", "cuatro", "cinco"]);
const COUNTDOWN_CUE_WORDS = new Set(["accion", "ya", "grabando", "camara", "luces", "claqueta", "rec", "grabar"]);

/**
 * Strips a spoken clapperboard countdown ("3, 2, 1, acción") from the very
 * start of a run. It's real production audio, not script content, but it
 * routinely runs straight into the actual line with no silence gap for
 * segmentIntoRuns to split on — confirmed on real AZ footage, where "2, 1,
 * acción. Soy ..." came through as a single continuous run and the countdown
 * ended up baked into the cut.
 *
 * Requires at least TWO consecutive countdown words right at the start
 * before assuming anything: a single leading number is ordinary script
 * content too (ADS-06's real line opens with "Uno: revisamos gratis..."),
 * so one alone is never enough to trigger this.
 */
export function stripLeadingCountdown(words: readonly TranscriptWord[]): readonly TranscriptWord[] {
  let i = 0;
  while (i < words.length && COUNTDOWN_WORDS.has(normalizeToken(words[i]!.text))) i++;
  if (i < 2) return words;
  if (i < words.length && COUNTDOWN_CUE_WORDS.has(normalizeToken(words[i]!.text))) i++;
  return words.slice(i);
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
  /**
   * At or above this match score, the script's own wording is trusted
   * enough to REPLACE the transcript's guess in the subtitles (2.6) — a
   * base whisper.cpp model routinely mishears acronyms/proper nouns
   * ("RUC" → "aría uce", confirmed on real audio in Fase 1), but the
   * segment's script-position score already measures exactly how well the
   * two line up, so no separate check is needed. Below this, the segment
   * keeps the transcript's own words and subtitles.ts marks it low-confidence.
   */
  guionTextConfidence?: number;
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
  guionTextConfidence: 0.35,
};

interface ScoredRun {
  assetPath: string;
  run: SpeechRun;
  scriptPosition: number; // token index of the best-matching window in the script
  score: number;
  /** The script's OWN words for the matched window — correct spelling/accents, unlike the transcript. Empty when the match was too weak to trust. */
  guionWords: string[];
}

/**
 * Where in the script's token stream this run's text best matches, AND the
 * script's own (correctly spelled) words for that span — used both to order
 * segments by script position (not recording order) and, later, to swap the
 * transcript's guesses for the script's real wording in the subtitles
 * (2.6). `scriptWordsOriginal` and `scriptTokensNormalized` must be the
 * same length, index-for-index (see splitOriginalWords/normalizeToken).
 */
function bestScriptPosition(
  runText: string,
  scriptTokensNormalized: string[],
  scriptWordsOriginal: string[],
): { position: number; score: number; guionWords: string[] } {
  const runTokens = tokenize(runText);
  if (runTokens.length === 0 || scriptTokensNormalized.length === 0) {
    return { position: 0, score: 0, guionWords: [] };
  }

  const runGrams = ngrams(runTokens, 2);

  // Assuming the matching script span has exactly as many words as the run
  // does is wrong whenever whisper.cpp's word count for a stretch doesn't
  // match the script's own — routine for an acronym it doesn't know
  // ("Sunarp" transcribed as two words, "su narb") — and it was wrong by
  // enough on real audio to visibly duplicate two words across a segment
  // boundary. Trying a small spread of window sizes around the run's own
  // length, not just that exact length, is what actually fixes it: the
  // correctly-sized window scores at least as well as the wrong-sized one
  // (real script words in the right place beat an accidental partial
  // match), so the highest score reliably lands on the right span.
  let best = { position: 0, score: 0, windowSize: Math.max(runTokens.length, 3) };
  for (let delta = -2; delta <= 2; delta += 1) {
    // Never below 3: ngrams() falls back to treating a <2-token window as a
    // single "unigram" (deliberately, for scoring genuinely short strings
    // elsewhere) — at windowSize 1 that turns into "does this one word
    // equal that one word," which scores a meaningless perfect 1.0 for any
    // short/filler run that happens to share one common word ("tu", "la",
    // "en"...) with the script. Confirmed on real audio: without this
    // floor, a stray one-word fragment matched at score 1.0 and became its
    // own bogus EDL segment.
    const windowSize = Math.max(3, runTokens.length + delta);
    for (let i = 0; i <= Math.max(0, scriptTokensNormalized.length - 1); i += 1) {
      const window = scriptTokensNormalized.slice(i, i + windowSize);
      const score = diceSimilarity(runGrams, ngrams(window, 2));
      if (score > best.score) best = { position: i, score, windowSize };
    }
  }
  return {
    position: best.position,
    score: best.score,
    guionWords: scriptWordsOriginal.slice(best.position, best.position + best.windowSize),
  };
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
  const scriptWordsOriginal = splitOriginalWords(scriptVideo.guion);
  const scriptTokensNormalized = scriptWordsOriginal.map(normalizeToken);

  const candidates: ScoredRun[] = [];
  for (const analysis of assetAnalyses) {
    const runs = segmentIntoRuns(analysis.words, analysis.silences);
    for (const rawRun of runs) {
      const words = stripLeadingCountdown(rawRun.words);
      if (words.length === 0) continue;
      const run = words.length === rawRun.words.length ? rawRun : toRun(words as TranscriptWord[]);
      const text = run.words.map((w) => w.text).join(" ");
      const { position, score, guionWords } = bestScriptPosition(text, scriptTokensNormalized, scriptWordsOriginal);
      if (score >= opts.minRunScore) {
        candidates.push({ assetPath: analysis.assetPath, run, scriptPosition: position, score, guionWords });
      }
    }
  }

  // Retakes: two runs are "the same line" if their OWN texts are similar to
  // each other, not just both similar to the script (a script line can
  // legitimately repeat words across genuinely different lines). The one
  // that matches the SCRIPT better wins — not simply whichever was recorded
  // later. Recording-order was tried first (a false start followed by a full
  // take is common), but it breaks just as easily the other way: a talent
  // nails the line, then keeps rolling through an unrelated retake or a
  // camera/lighting test that was never trimmed out of the file, which would
  // otherwise silently displace the actually-correct take. Scoring against
  // the script itself is agnostic to which side of the good take the extra
  // material falls on. Ties keep the later run, matching the old default
  // when nothing else distinguishes the candidates.
  const kept: ScoredRun[] = [];
  for (const candidate of candidates) {
    const candidateText = candidate.run.words.map((w) => w.text).join(" ");
    const duplicateIndex = kept.findIndex(
      (existing) =>
        textContainment(candidateText, existing.run.words.map((w) => w.text).join(" ")) >= opts.duplicateThreshold,
    );
    if (duplicateIndex === -1) {
      kept.push(candidate);
    } else if (candidate.score >= kept[duplicateIndex]!.score) {
      kept[duplicateIndex] = candidate;
    }
  }

  kept.sort((a, b) => a.scriptPosition - b.scriptPosition);

  const segmentos: EdlSegment[] = kept.map((c) => ({
    archivo: c.assetPath,
    inicio: Math.max(0, c.run.startSec - opts.marginSec),
    fin: c.run.endSec + opts.marginSec,
    lineaGuion: c.run.words.map((w) => w.text).join(" "),
    videoId: scriptVideo.id,
    // Only trusted enough to show verbatim above guionTextConfidence — a
    // weak match's guionWords could easily be the WRONG stretch of script,
    // which would be a worse subtitle than the transcript's own guess.
    guionTexto: c.score >= opts.guionTextConfidence && c.guionWords.length > 0 ? c.guionWords.join(" ") : undefined,
  }));

  return { videoId: scriptVideo.id, segmentos };
}
