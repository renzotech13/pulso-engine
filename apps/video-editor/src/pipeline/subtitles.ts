// 2.6: remaps each kept word's timing from its SOURCE file onto the EDL's
// post-cut timeline, swaps in the script's own (correctly spelled/accented)
// wording wherever the alignment trusted it enough to (buildEdl's
// guionTexto — see alignment.ts), groups words into timed blocks per the
// preset's palabrasPorBloque, and wraps each block's text into display
// lines per maxCaracteresPorLinea/maxLineas.

import { alignWordSequences, normalizeToken, splitOriginalWords } from "./alignment.js";
import type { AudioAnalysis, Edl, SubtitleBlock, SubtitleTrack, TranscriptWord } from "./types.js";

const DEFAULT_WORDS_PER_BLOCK = 6;

interface ResolvedWord extends TranscriptWord {
  /** True when this word's text is the raw transcript guess, not the script's own wording — either guionTexto was absent or its word count didn't line up with the audio. */
  bajaConfianza: boolean;
}

/**
 * A word count that doesn't match exactly is the COMMON case, not the
 * exception: whisper.cpp routinely spells an acronym out as separate
 * letters or extra syllables ("RUC" → "aría uce", "Sunarp" → "su narb",
 * both confirmed on real audio), which shifts the transcript's word count
 * for that stretch without changing what was actually said. Requiring an
 * EXACT match would throw away the script's correct spelling for exactly
 * the words most likely to need it. Instead, only refuse the swap when the
 * counts are wildly different — a good sign the matched span itself is
 * wrong, not just re-worded by a couple of split-up words.
 */
function countsCloseEnough(guionCount: number, transcriptCount: number): boolean {
  const diff = Math.abs(guionCount - transcriptCount);
  return diff <= Math.max(2, Math.round(transcriptCount * 0.25));
}

/** Nearest non-null entry to index `i` — used to give a deleted (unaligned) transcript word SOME script text rather than none, preferring the closer neighbor and the left one on a tie (reads naturally as "still finishing the previous script word"). */
function nearestAligned(alignment: readonly (number | null)[], i: number): number | null {
  for (let offset = 0; offset < alignment.length; offset++) {
    if (alignment[i - offset] !== undefined && alignment[i - offset] !== null) return alignment[i - offset]!;
    if (alignment[i + offset] !== undefined && alignment[i + offset] !== null) return alignment[i + offset]!;
  }
  return null;
}

/**
 * One EDL segment's words, retimed onto the OUTPUT timeline and, when
 * trustworthy, showing the SCRIPT's spelling instead of the transcript's.
 * Uses a real sequence alignment (alignWordSequences) rather than
 * proportionally compressing one length onto the other — proportional
 * mapping smears a single divergence across the WHOLE segment via
 * rounding (confirmed on real audio: it duplicated the segment's first
 * word even though the true mismatch was several words later), while
 * alignment localizes it to just the words that actually diverged. A
 * genuinely large mismatch (see countsCloseEnough) means the matched span
 * itself is unreliable, so that segment falls back to the transcript
 * verbatim and is marked low-confidence instead of guessing.
 */
function resolveSegmentWords(
  segment: Edl["segmentos"][number],
  analysis: AudioAnalysis | undefined,
  outputCursor: number,
): ResolvedWord[] {
  if (!analysis) return [];

  const transcriptWords = analysis.words.filter((w) => w.startSec >= segment.inicio && w.endSec <= segment.fin);
  if (transcriptWords.length === 0) return [];

  const guionWords = segment.guionTexto ? splitOriginalWords(segment.guionTexto) : [];
  const useGuionText = guionWords.length > 0 && countsCloseEnough(guionWords.length, transcriptWords.length);

  const alignment = useGuionText
    ? alignWordSequences(transcriptWords.map((w) => normalizeToken(w.text)), guionWords.map(normalizeToken))
    : [];

  const resolved = transcriptWords.map((word, i) => {
    const guionIndex = useGuionText ? (alignment[i] ?? nearestAligned(alignment, i)) : null;
    return {
      text: guionIndex !== null ? guionWords[guionIndex]! : word.text,
      startSec: outputCursor + (word.startSec - segment.inicio),
      endSec: outputCursor + (word.endSec - segment.inicio),
      bajaConfianza: !useGuionText,
    };
  });

  // A transcript word with no script counterpart of its own (nearestAligned
  // above) borrows its neighbor's — an unavoidable tie whenever a mis-heard
  // acronym splits into more transcript words than the script has for it
  // ("Sunarp" → "su narb" both fall back to the same neighbor). Showing the
  // exact same word twice in a row reads as a typo, not as "the model said
  // it slowly," so the duplicate is dropped and folded into the word it
  // copied from — extending THAT word's end time to cover the dropped
  // word's audio too, so the karaoke highlight still spans the full sound
  // instead of cutting off early. Real deliberate repetition in a script
  // ("vamos, vamos") is rare enough in this kind of short-form copy that
  // the trade-off is worth it.
  const deduped: ResolvedWord[] = [];
  for (const word of resolved) {
    const previous = deduped.at(-1);
    if (previous && word.text.toLowerCase() === previous.text.toLowerCase()) {
      previous.endSec = word.endSec;
    } else {
      deduped.push({ ...word });
    }
  }
  return deduped;
}

/**
 * A word only has a meaningful place in the OUTPUT timeline once we know
 * which EDL segment it fell inside (segments already exclude everything cut
 * away) and how far into that segment it is — everything before the first
 * segment's start, after the last one's end, or in a gap between segments
 * that got cut has no output position and is dropped.
 */
export function remapWordsToEdlTimeline(edl: Edl, analysesByAsset: ReadonlyMap<string, AudioAnalysis>): ResolvedWord[] {
  const remapped: ResolvedWord[] = [];
  let outputCursor = 0;

  for (const segment of edl.segmentos) {
    remapped.push(...resolveSegmentWords(segment, analysesByAsset.get(segment.archivo), outputCursor));
    outputCursor += segment.fin - segment.inicio;
  }

  return remapped;
}

export function groupWordsIntoBlocks(words: readonly ResolvedWord[], wordsPerBlock = DEFAULT_WORDS_PER_BLOCK): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = [];
  for (let i = 0; i < words.length; i += wordsPerBlock) {
    const chunk = words.slice(i, i + wordsPerBlock);
    if (chunk.length === 0) continue;
    blocks.push({
      startSec: chunk[0]!.startSec,
      endSec: chunk[chunk.length - 1]!.endSec,
      text: chunk.map((w) => w.text).join(" "),
      words: chunk.map(({ text, startSec, endSec }) => ({ text, startSec, endSec })),
      // One mistranscribed word makes the whole cue worth a second look —
      // blocks are short (palabrasPorBloque is typically 3-6 words), so
      // "any word low-confidence" and "cue low-confidence" are effectively
      // the same granularity a reviewer would want anyway.
      bajaConfianza: chunk.some((w) => w.bajaConfianza),
    });
  }
  return blocks;
}

export function buildSubtitleTrack(
  edl: Edl,
  analysesByAsset: ReadonlyMap<string, AudioAnalysis>,
  wordsPerBlock?: number,
): SubtitleTrack {
  const words = remapWordsToEdlTimeline(edl, analysesByAsset);
  return { videoId: edl.videoId, bloques: groupWordsIntoBlocks(words, wordsPerBlock) };
}

/**
 * Greedy word-wrap, never splitting a word. A block that genuinely can't
 * fit in maxLineas lines of maxCaracteresPorLinea each just overflows on
 * the last line rather than losing words — palabrasPorBloque keeps blocks
 * short enough that this is the rare exception, not the common case, and
 * an overlong line is a far smaller problem than silently dropped text.
 */
export function wrapIntoLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const onLastAllowedLine = lines.length === maxLines - 1;
    if (candidate.length > maxCharsPerLine && current && !onLastAllowedLine) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines;
}

function formatSrtTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function toSrt(track: SubtitleTrack, maxCharsPerLine = 37, maxLines = 2): string {
  return track.bloques
    .map((block, index) => {
      const cueNumber = index + 1;
      const text = wrapIntoLines(block.text, maxCharsPerLine, maxLines).join("\n");
      return `${cueNumber}\n${formatSrtTimestamp(block.startSec)} --> ${formatSrtTimestamp(block.endSec)}\n${text}\n`;
    })
    .join("\n");
}
