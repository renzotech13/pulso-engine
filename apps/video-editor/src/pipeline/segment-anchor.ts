// The rule every EDL segment follows: it opens exactly on its first script
// word. buildEdl already decides WHICH transcript words a take contributes
// (the first one that matches the script, not the director's countdown), but
// the full-file transcription can time a segment's opening words a second or
// more too early — whisper drops the countdown ("tres, dos, uno, va") from the
// text, and the untranscribed speech drags nearby DTW timestamps with it.
// Confirmed on real AZ footage: ADS-01-ESCENA-03-PARTE-02 had "Sin" at 10.64s
// (real: ~11.5s), ADS-01-ESCENA-05 had "Escríbenos" starting 5s early. A second,
// short transcription of only the few seconds around the opening words gets
// them right ("sin" 11.64, "escri" 14.88 — both matching the audio envelope).

import { sameSpokenWord } from "./alignment.js";
import type { TranscriptionProvider } from "./transcription.js";
import type { AudioAnalysis, Edl, TranscriptWord } from "./types.js";

/** How far before the opening word's (possibly wrong) end the focused transcription starts. */
const LEAD_SEC = 3;
/** How far after it the focused transcription runs — enough for the next couple of words to confirm the match. */
const TAIL_SEC = 2.5;
/** Opening words re-timed from the focused transcription; later words were never the problem. */
const MAX_RETIMED_WORDS = 3;
/** Both passes putting a word's end this close together means they agree on where the word is. */
const END_AGREEMENT_SEC = 0.3;
/** A focused-pass word shorter than this was squeezed by a hallucinated neighbor, not really timed. */
const MIN_PLAUSIBLE_WORD_SEC = 0.06;

/**
 * Finds the segment's opening words inside the focused transcription and
 * reconciles the two passes word by word. Requires the first two words to
 * match in sequence when the segment has two (a lone common word like "y"
 * could match anywhere in the window); among several matches, picks the one
 * closest in time to where the full-file pass put it.
 *
 * The focused pass isn't trusted blindly — it hallucinates too: on the real
 * ADS-01-ESCENA-04 window it invented a "Hola" right before "soy", which took
 * the real start of "soy" and left it 0.02s long. So:
 *  - when both passes agree on where a word ENDS, they agree on the word; the
 *    earlier of the two starts is kept for the opening word (starting a hair
 *    early keeps a sliver of silence, starting late cuts the word);
 *  - when they disagree, the full-file position was wrong (ADS-01-ESCENA-03-
 *    PARTE-02: "Sin" ended at 10.64 there, 11.64 in the focused pass) and the
 *    focused timing is used — if it's a plausible length at all.
 * Undefined when the opening word can't be found or can't be trusted — the
 * caller then keeps the original timing.
 */
export function retimeOpeningWords(
  segmentWords: readonly TranscriptWord[],
  windowWords: readonly TranscriptWord[],
): TranscriptWord[] | undefined {
  const first = segmentWords[0];
  if (!first) return undefined;
  const second = segmentWords[1];

  let bestIndex = -1;
  for (let j = 0; j < windowWords.length; j++) {
    if (!sameSpokenWord(windowWords[j]!.text, first.text)) continue;
    if (second && !(windowWords[j + 1] && sameSpokenWord(windowWords[j + 1]!.text, second.text))) continue;
    const distance = Math.abs(windowWords[j]!.endSec - first.endSec);
    if (bestIndex === -1 || distance < Math.abs(windowWords[bestIndex]!.endSec - first.endSec)) bestIndex = j;
  }
  if (bestIndex === -1) return undefined;

  const retimed: TranscriptWord[] = [];
  for (let k = 0; k < MAX_RETIMED_WORDS && k < segmentWords.length; k++) {
    const original = segmentWords[k]!;
    const focused = windowWords[bestIndex + k];
    if (!focused || !sameSpokenWord(focused.text, original.text)) break;

    const previousEnd = retimed.at(-1)?.endSec ?? -Infinity;
    let word: TranscriptWord;
    if (Math.abs(focused.endSec - original.endSec) <= END_AGREEMENT_SEC) {
      const startSec = k === 0 ? Math.min(original.startSec, focused.startSec) : original.startSec;
      word = { text: original.text, startSec, endSec: original.endSec };
    } else if (focused.endSec - focused.startSec >= MIN_PLAUSIBLE_WORD_SEC) {
      word = { text: original.text, startSec: focused.startSec, endSec: focused.endSec };
    } else {
      break;
    }
    if (word.startSec < previousEnd) word = { ...word, startSec: previousEnd, endSec: Math.max(word.endSec, previousEnd + 0.01) };
    retimed.push(word);
  }
  return retimed.length > 0 ? retimed : undefined;
}

/**
 * Applies retimed opening words back onto the file's own word list and keeps
 * everything after them in order — a later word whose (untouched) start now
 * falls before the last retimed word's end is pushed forward to it.
 */
export function applyRetimedWords(
  fileWords: TranscriptWord[],
  firstIndex: number,
  retimed: readonly TranscriptWord[],
  lastIndexInSegment: number,
): void {
  retimed.forEach((word, k) => {
    fileWords[firstIndex + k] = { ...fileWords[firstIndex + k]!, startSec: word.startSec, endSec: word.endSec };
  });
  for (let i = firstIndex + retimed.length; i <= lastIndexInSegment; i++) {
    const previousEnd = fileWords[i - 1]!.endSec;
    const word = fileWords[i]!;
    if (word.startSec < previousEnd) {
      fileWords[i] = { ...word, startSec: previousEnd, endSec: Math.max(word.endSec, previousEnd + 0.01) };
    }
  }
}

/**
 * Re-times every segment's opening words with a focused transcription and
 * moves each segment's `inicio` to its first script word (minus the preset's
 * silence margin). Mutates `analysesByAsset` in place — subtitles read their
 * word timings from there — and returns the asset paths whose word lists
 * changed, so the caller can persist them. A focused transcription that fails
 * or can't find the opening word leaves that segment exactly as it was.
 */
export async function anchorSegmentOpenings(
  edl: Edl,
  analysesByAsset: ReadonlyMap<string, AudioAnalysis>,
  provider: TranscriptionProvider,
  language: string,
  marginSec: number,
): Promise<{ edl: Edl; retimedAssets: Set<string> }> {
  const retimedAssets = new Set<string>();
  const segmentos = [];

  for (const segment of edl.segmentos) {
    const analysis = analysesByAsset.get(segment.archivo);
    const indices = analysis
      ? analysis.words.flatMap((w, i) => (w.startSec >= segment.inicio && w.endSec <= segment.fin ? [i] : []))
      : [];
    if (!analysis || indices.length === 0) {
      segmentos.push(segment);
      continue;
    }

    const segmentWords = indices.map((i) => analysis.words[i]!);
    const rangeStart = Math.max(0, segmentWords[0]!.endSec - LEAD_SEC);
    let windowWords: TranscriptWord[];
    try {
      windowWords = await provider.transcribe(segment.archivo, language, {
        startSec: rangeStart,
        durationSec: LEAD_SEC + TAIL_SEC,
      });
    } catch {
      segmentos.push(segment);
      continue;
    }

    const retimed = retimeOpeningWords(segmentWords, windowWords);
    if (!retimed || retimed.length === 0) {
      segmentos.push(segment);
      continue;
    }

    applyRetimedWords(analysis.words, indices[0]!, retimed, indices.at(-1)!);
    retimedAssets.add(segment.archivo);

    const inicio = Math.max(0, retimed[0]!.startSec - marginSec);
    segmentos.push({ ...segment, inicio: Math.min(inicio, segment.fin - marginSec) });
  }

  return { edl: { ...edl, segmentos }, retimedAssets };
}
