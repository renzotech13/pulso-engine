// 2.4: assigns raw clips to the script they belong to, finds which parts of
// each clip are actual usable takes (vs. false starts, filler, repeated
// attempts), and orders the result into an EDL that follows the SCRIPT's
// order — not the files' chronological order, per the spec.
//
// Deliberately dependency-free (no fuzzy-matching library): word n-gram
// Dice similarity is simple enough to unit-test exhaustively and good
// enough for "does this clip's speech resemble this script," which is a
// much coarser question than "align these two strings precisely."

import path from "node:path";
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

/** Two whisper passes (or a mis-transcription vs. the script's own spelling) for what's really the same spoken word — "Sigueis"/"Sigues", "Escríbenos"/"escribenos". Guarded to length >= 3 (normalized) since a short function word ("y"/"yo", "tu"/"su") is one edit apart from plenty of unrelated words. */
export function sameSpokenWord(a: string, b: string): boolean {
  const x = normalizeToken(a);
  const y = normalizeToken(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 3 || y.length < 3) return false;
  const longest = Math.max(x.length, y.length);
  return 1 - levenshteinDistance(x, y) / longest >= 0.7;
}

function ngrams(tokens: string[], n: number): Set<string> {
  if (tokens.length < n) return new Set(tokens.length > 0 ? [tokens.join(" ")] : []);
  const result = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) result.add(tokens.slice(i, i + n).join(" "));
  return result;
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      currentRow[j] =
        a[i - 1] === b[j - 1]
          ? prevRow[j - 1]!
          : 1 + Math.min(prevRow[j - 1]!, prevRow[j]!, currentRow[j - 1]!);
    }
    prevRow = currentRow;
  }
  return prevRow[b.length]!;
}

/**
 * Cost of substituting token `a` for token `b` in alignWordSequences below:
 * 0 for an exact match, otherwise the normalized edit distance (0,1] rather
 * than a flat 1. A flat substitution cost made a REAL word-count mismatch
 * (the script says one extra/different word than what was actually said)
 * resolve by tie-breaking order alone — confirmed on real AZ footage: with
 * transcript "...te diremos qué..." against script "...te decimos hoy
 * qué...", a flat cost aligned "diremos" to "hoy" (total edit cost is
 * identical either way) and silently dropped "decimos" from the subtitle
 * entirely. Weighting by similarity makes the DP prefer the substitution
 * that's actually plausible ("diremos"/"decimos" share most of their
 * letters) over one that just happens to be positionally convenient
 * ("diremos"/"hoy" share none) — capped at 1 so a wildly different
 * substitution never costs MORE than deleting and inserting separately
 * would.
 */
function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 0 : Math.min(1, levenshteinDistance(a, b) / maxLen);
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
      const cost = substitutionCost(a[i - 1]!, b[j - 1]!);
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
  // Fractional substitution costs mean an exact === can miss a genuine tie
  // to floating-point rounding, so comparisons use a small epsilon.
  const FLOAT_EPS = 1e-9;
  const alignment: Array<number | null> = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const cost = i > 0 && j > 0 ? substitutionCost(a[i - 1]!, b[j - 1]!) : 0;
    if (i > 0 && j > 0 && Math.abs(dp[i]![j]! - (dp[i - 1]![j - 1]! + cost)) < FLOAT_EPS) {
      alignment[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && Math.abs(dp[i]![j]! - (dp[i - 1]![j]! + 1)) < FLOAT_EPS) {
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
// "va" confirmed on real AZ footage (whisper.cpp transcript: "3, 2, 1, va."
// repeated across multiple takes) — this crew's own cue word for "go/action".
// Real production audio, never real ad copy this early: no script opens
// with a director calling "acción" or a second voice answering "ya"/"va".
const CUE_WORDS = new Set([
  "accion",
  "ya",
  "va",
  "grabando",
  "camara",
  "luces",
  "claqueta",
  "rec",
  "grabar",
  "corte",
  "listo",
  "listos",
]);

// Ordinary connector words that can sit BETWEEN countdown/cue words in a real
// clapperboard call without being real script content themselves — confirmed
// on real AZ footage: "¡Grabando EN 3, 2, 1, Acción!". Only ever tolerated
// when a real countdown/cue word follows immediately after (see
// stripLeadingCountdown) — on their own they're completely ordinary Spanish
// and plenty of real script lines contain them.
const COUNTDOWN_CONNECTOR_WORDS = new Set(["en", "y"]);

function isCountdownOrCueWord(text: string): boolean {
  const token = normalizeToken(text);
  return COUNTDOWN_WORDS.has(token) || CUE_WORDS.has(token);
}

/**
 * Strips leading clapperboard/set chatter — a spoken countdown ("3, 2, 1,
 * acción"), a bare director/talent exchange with no numbers at all
 * ("Acción" ... "Ya" — confirmed on real AZ footage: two different voices,
 * one giving the cue and the other confirming), or any mix of the two — from
 * the very start of a run. It's real production audio, not script content,
 * but it routinely runs straight into the actual line with no silence gap
 * for segmentIntoRuns to split on.
 *
 * Consumes consecutive digit/cue words from BOTH vocabularies together
 * (not "digits, then at most one cue word") — a run of "3, 2, 1, acción, ya"
 * needs every one of those five stripped, not just the first four, or the
 * leftover "ya" ends up spoken over the real line's opening word. A lone
 * ordinary connector ("en", "y") is also tolerated, but ONLY when a real
 * countdown/cue word immediately follows it — "¡Grabando en 3, 2, 1,
 * Acción!" needs "en" stripped too, but a connector with nothing
 * countdown-shaped after it just ends the run normally (real script content
 * routinely contains "en"/"y", so one on its own proves nothing).
 *
 * Requires at least TWO consecutive words from the countdown/cue vocabulary
 * (connectors don't count toward this) right at the start before assuming
 * anything: a single leading number OR a single "ya" is ordinary script
 * content too (ADS-06 opens a line with "Uno: revisamos gratis...", ADS-05
 * opens one with "Ya sé qué tengo que ordenar..."), so one alone is never
 * enough to trigger this.
 */
export function stripLeadingCountdown(words: readonly TranscriptWord[]): readonly TranscriptWord[] {
  let i = 0;
  let matchCount = 0;
  let cutAt = 0;

  while (i < words.length) {
    if (isCountdownOrCueWord(words[i]!.text)) {
      i++;
      matchCount++;
      cutAt = i;
      continue;
    }
    const isConnector = COUNTDOWN_CONNECTOR_WORDS.has(normalizeToken(words[i]!.text));
    if (isConnector && i + 1 < words.length && isCountdownOrCueWord(words[i + 1]!.text)) {
      i++; // tentatively skip; cutAt only advances past this once the next real match lands
      continue;
    }
    break;
  }

  if (matchCount < 2) return words;
  return words.slice(cutAt);
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
export const DEFAULT_EDL_MARGIN_SEC = 0.2;

const DEFAULT_OPTIONS: Required<BuildEdlOptions> = {
  minRunScore: 0.15,
  duplicateThreshold: 0.7,
  marginSec: DEFAULT_EDL_MARGIN_SEC,
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
 * Finds the tightest contiguous sub-range of `words` whose text best matches
 * the script. Real takes routinely have off-script chatter stapled onto a
 * run that segmentIntoRuns couldn't split apart because there's no detected
 * silence between the junk and the real line — direction, renegotiating a
 * price out loud, a countdown that isn't at the very start (stripLeadingCountdown
 * only catches one at position zero). Confirmed on real AZ footage: a run
 * transcribed as "Es verdad. No pasa nada... Ahí está bien. Sí. 3, 2, 1, va.
 * Sin costos escondidos y con tu primera asesoría..." scored high enough
 * (chatter diluted but didn't kill the match) to become a candidate with ALL
 * of that baked into the final cut.
 *
 * Word-for-word alignment (alignWordSequences, the same tool subtitles.ts
 * uses for spelling correction) was tried here first and rejected: its edit
 * distance costs a substitution the same as a deletion, so on a tie the
 * backtrack prefers substituting a chatter word against whatever script word
 * happens to be adjacent rather than marking it unaligned — it essentially
 * never recognizes chatter as chatter, confirmed by it leaving both test
 * cases below completely untrimmed.
 *
 * Greedily trims from whichever end currently improves the match score more,
 * stopping the moment neither end helps — cheap (a handful of iterations,
 * not exhaustive over every sub-range) and correct for the realistic shape
 * of the problem: junk sits at one end, not scattered through the middle of
 * an otherwise-clean take.
 */
/**
 * The n-gram window search picks whichever start/size scores best on shared
 * BIGRAMS — a run's own first or last word being a near-miss mis-transcription
 * of the script word right outside the window (rather than an exact match)
 * doesn't cost the window anything to exclude, since that word's bigrams
 * never overlap the script's anyway. Confirmed on real AZ footage: whisper
 * heard "Sigues" as "Sigueis," and the best-scoring window started at
 * "vendiendo," leaving "¿Sigues" out of guionWords entirely — the segment
 * then displayed whisper's misspelling for that word forever, script or not.
 * This extends the window by exactly one word on either edge when that edge
 * word is a close-enough match (sameSpokenWord) to the script word sitting
 * immediately outside it.
 */
function extendForNearMissEdges(
  trimmedWords: readonly TranscriptWord[],
  position: number,
  guionWords: readonly string[],
  scriptWordsOriginal: readonly string[],
): { position: number; guionWords: string[] } {
  let start = position;
  const result = [...guionWords];

  const firstWord = trimmedWords[0];
  const before = scriptWordsOriginal[start - 1];
  if (firstWord && before && result[0] !== before && sameSpokenWord(firstWord.text, before)) {
    start -= 1;
    result.unshift(before);
  }

  const lastWord = trimmedWords.at(-1);
  const after = scriptWordsOriginal[position + guionWords.length];
  if (lastWord && after && result.at(-1) !== after && sameSpokenWord(lastWord.text, after)) {
    result.push(after);
  }

  return { position: start, guionWords: result };
}

function trimRunToBestMatch(
  words: readonly TranscriptWord[],
  scriptTokensNormalized: string[],
  scriptWordsOriginal: string[],
): { words: readonly TranscriptWord[]; position: number; score: number; guionWords: string[] } {
  const scoreRange = (lo: number, hi: number) => {
    const text = words
      .slice(lo, hi)
      .map((w) => w.text)
      .join(" ");
    return bestScriptPosition(text, scriptTokensNormalized, scriptWordsOriginal);
  };

  let lo = 0;
  let hi = words.length;
  let best = scoreRange(lo, hi);

  // Only worth hunting for a tighter sub-range when the whole run's own
  // match is already weak enough to suggest it's diluted by off-script
  // content. A run that matches cleanly as a whole should never get
  // shrunk just because some smaller inner slice happens to score
  // marginally higher — a clean 10-word take and its own best 7-word
  // substring both score close to 1.0, and greedily preferring the
  // smaller one throws away real content (confirmed: this exact thing
  // broke a passing test before this threshold was added) for no actual
  // gain.
  if (best.score >= 0.5) {
    const extended = extendForNearMissEdges(words, best.position, best.guionWords, scriptWordsOriginal);
    return { words, position: extended.position, score: best.score, guionWords: extended.guionWords };
  }

  let improved = true;
  while (improved && hi - lo > 3) {
    improved = false;
    const trimLeft = scoreRange(lo + 1, hi);
    const trimRight = scoreRange(lo, hi - 1);
    if (trimLeft.score > best.score && trimLeft.score >= trimRight.score) {
      lo += 1;
      best = trimLeft;
      improved = true;
    } else if (trimRight.score > best.score) {
      hi -= 1;
      best = trimRight;
      improved = true;
    }
  }

  const trimmedWords = words.slice(lo, hi);
  const extended = extendForNearMissEdges(trimmedWords, best.position, best.guionWords, scriptWordsOriginal);
  return { words: trimmedWords, position: extended.position, score: best.score, guionWords: extended.guionWords };
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
      const afterCountdown = stripLeadingCountdown(rawRun.words);
      if (afterCountdown.length === 0) continue;
      const { words: trimmedWords, position, score, guionWords } = trimRunToBestMatch(
        afterCountdown,
        scriptTokensNormalized,
        scriptWordsOriginal,
      );
      if (trimmedWords.length === 0) continue;
      const run = toRun(trimmedWords as TranscriptWord[]);
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

// --- Escenas y línea de tiempo de salida (2.8, render.ts + 2.6, subtitles.ts) ---

/**
 * Groups a raw take with its own retakes/parts of the SAME scene — real crews
 * commonly split one continuous scene across files ("ADS-01-ESCENA-03-PARTE-01",
 * "...-PARTE-02") when a recording gets stopped and restarted. Two segments
 * whose files share everything up to that "-PARTE-N" suffix are the same
 * scene; anything else (a different scene, a different take with no PARTE
 * suffix at all) gets its own key. Best-effort: a tenant with a different
 * naming convention just gets every segment treated as its own scene, which
 * is the same behavior as before this existed.
 */
export function sceneKeyForFile(filePath: string): string {
  const base = path.basename(filePath).replace(/\.[^.]+$/, "");
  return base.replace(/-parte-?\d+$/i, "");
}

/**
 * Where each EDL segment actually starts on the OUTPUT timeline once
 * transitions are in play — needed by BOTH the renderer (to place each
 * xfade) and the subtitle timer (buildSubtitleTrack), which must agree on
 * this or subtitles drift later and later after every transition. A
 * transition between two DIFFERENT scenes overlaps (and so shortens the
 * timeline by) `transitionDurationSec`; a hard cut between parts of the SAME
 * scene (see sceneKeyForFile) doesn't shorten anything. Pass 0 for a preset
 * that doesn't use transitions at all — every segment then starts exactly
 * where the naive sum of prior durations would put it, matching
 * concatenateSegments' plain hard-cut behavior.
 */
export function computeSegmentStartOffsets(
  segmentos: readonly Pick<EdlSegment, "archivo" | "inicio" | "fin">[],
  transitionDurationSec: number,
): number[] {
  const offsets: number[] = new Array(segmentos.length).fill(0);
  let cursor = 0;
  for (let i = 0; i < segmentos.length; i++) {
    offsets[i] = cursor;
    if (i + 1 < segmentos.length) {
      const sameScene = sceneKeyForFile(segmentos[i + 1]!.archivo) === sceneKeyForFile(segmentos[i]!.archivo);
      const reduction = sameScene ? 0 : transitionDurationSec;
      cursor += segmentos[i]!.fin - segmentos[i]!.inicio - reduction;
    }
  }
  return offsets;
}
