// 2.6, Fase 1 scope: remaps each kept word's timing from its SOURCE file
// onto the EDL's post-cut timeline, then groups words into blocks. Text
// comes straight from the transcript for now — swapping in the script's
// own (correctly accented/spelled) wording via token alignment, and the
// full styling (karaoke, boxes, preset-driven grouping), is Fase 2. This
// still has to exist in Fase 1 because "render with basic subtitles" is
// literally the phase's exit criterion.

import type { AudioAnalysis, Edl, SubtitleBlock, SubtitleTrack, TranscriptWord } from "./types.js";

const DEFAULT_WORDS_PER_BLOCK = 6;

/**
 * A word only has a meaningful place in the OUTPUT timeline once we know
 * which EDL segment it fell inside (segments already exclude everything cut
 * away) and how far into that segment it is — everything before the first
 * segment's start, after the last one's end, or in a gap between segments
 * that got cut has no output position and is dropped.
 */
export function remapWordsToEdlTimeline(edl: Edl, analysesByAsset: ReadonlyMap<string, AudioAnalysis>): TranscriptWord[] {
  const remapped: TranscriptWord[] = [];
  let outputCursor = 0;

  for (const segment of edl.segmentos) {
    const analysis = analysesByAsset.get(segment.archivo);
    const segmentDuration = segment.fin - segment.inicio;
    if (analysis) {
      for (const word of analysis.words) {
        if (word.startSec < segment.inicio || word.endSec > segment.fin) continue;
        remapped.push({
          text: word.text,
          startSec: outputCursor + (word.startSec - segment.inicio),
          endSec: outputCursor + (word.endSec - segment.inicio),
        });
      }
    }
    outputCursor += segmentDuration;
  }

  return remapped;
}

export function groupWordsIntoBlocks(words: readonly TranscriptWord[], wordsPerBlock = DEFAULT_WORDS_PER_BLOCK): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = [];
  for (let i = 0; i < words.length; i += wordsPerBlock) {
    const chunk = words.slice(i, i + wordsPerBlock);
    if (chunk.length === 0) continue;
    blocks.push({
      startSec: chunk[0]!.startSec,
      endSec: chunk[chunk.length - 1]!.endSec,
      text: chunk.map((w) => w.text).join(" "),
      words: chunk,
      bajaConfianza: false,
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

function formatSrtTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function toSrt(track: SubtitleTrack): string {
  return track.bloques
    .map((block, index) => {
      const cueNumber = index + 1;
      return `${cueNumber}\n${formatSrtTimestamp(block.startSec)} --> ${formatSrtTimestamp(block.endSec)}\n${block.text}\n`;
    })
    .join("\n");
}
