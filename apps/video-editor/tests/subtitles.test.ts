import { describe, expect, it } from "vitest";
import { groupWordsIntoBlocks, remapWordsToEdlTimeline, toSrt, wrapIntoLines } from "../src/pipeline/subtitles.js";
import type { AudioAnalysis, Edl, EdlSegment, TranscriptWord } from "../src/pipeline/types.js";

function word(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec };
}

function resolvedWord(text: string, startSec: number, endSec: number, bajaConfianza = false) {
  return { text, startSec, endSec, bajaConfianza };
}

function segment(partial: Partial<EdlSegment> & Pick<EdlSegment, "archivo" | "inicio" | "fin">): EdlSegment {
  return { lineaGuion: "", videoId: "video-1", ...partial };
}

describe("remapWordsToEdlTimeline", () => {
  it("shifts a word's time by how far its segment sits into the OUTPUT timeline", () => {
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [
        segment({ archivo: "a.mp4", inicio: 10, fin: 12, lineaGuion: "hola" }),
        segment({ archivo: "a.mp4", inicio: 20, fin: 22, lineaGuion: "mundo" }),
      ],
    };
    const analysis: AudioAnalysis = {
      assetPath: "a.mp4",
      provider: "test",
      language: "es",
      words: [word("hola", 10.5, 11), word("mundo", 20.2, 20.8)],
      silences: [],
    };

    const remapped = remapWordsToEdlTimeline(edl, new Map([["a.mp4", analysis]]));

    // "hola" was 0.5s into its [10,12] segment -> 0.5s into the output.
    expect(remapped[0]!.text).toBe("hola");
    expect(remapped[0]!.startSec).toBeCloseTo(0.5);
    expect(remapped[0]!.endSec).toBeCloseTo(1);
    // "mundo"'s segment starts at output offset 2 (the first segment's
    // 12-10=2s duration), and it was 0.2s into its own [20,22] segment.
    expect(remapped[1]!.text).toBe("mundo");
    expect(remapped[1]!.startSec).toBeCloseTo(2.2);
    expect(remapped[1]!.endSec).toBeCloseTo(2.8);
  });

  it("shrinks the offset by the transition duration at a DIFFERENT-scene join, matching what render.ts actually plays", () => {
    // Real bug: render.ts's transitions mode overlaps (shortens) the output
    // at every different-scene xfade join, but this function used to just
    // add up segment durations as if every join were a hard cut — the
    // subtitle for every segment after the first transition started later
    // than the audio actually got there, and the gap compounded with each
    // further transition. Confirmed on real output: it read as the subtitle
    // "skipping" a segment's opening words once the drift caught up to the
    // next block boundary.
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [
        segment({ archivo: "ADS-01-ESCENA-03.mp4", inicio: 10, fin: 12 }),
        // A different scene (no shared "-PARTE-N"-stripped basename) — a
        // real transition, so the join overlaps and shortens the timeline.
        segment({ archivo: "ADS-01-ESCENA-04.mp4", inicio: 20, fin: 22 }),
      ],
    };
    const analyses = new Map<string, AudioAnalysis>([
      ["ADS-01-ESCENA-03.mp4", { assetPath: "ADS-01-ESCENA-03.mp4", provider: "test", language: "es", words: [word("hola", 10.5, 11)], silences: [] }],
      ["ADS-01-ESCENA-04.mp4", { assetPath: "ADS-01-ESCENA-04.mp4", provider: "test", language: "es", words: [word("mundo", 20.2, 20.8)], silences: [] }],
    ]);

    const remapped = remapWordsToEdlTimeline(edl, analyses, 0.4);

    // Without the transition duration, "mundo" would start at 2.2 (as the
    // very first test above shows for the no-transitions case). Joined with
    // a 0.4s transition, the second segment's own start offset is 2 - 0.4 =
    // 1.6, so "mundo" (0.2s into its segment) lands at 1.8, not 2.2.
    expect(remapped[1]!.startSec).toBeCloseTo(1.8);
  });

  it("does NOT shrink the offset across a SAME-scene hard cut (a real crew's own -PARTE split)", () => {
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [
        segment({ archivo: "ADS-01-ESCENA-03-PARTE-01.mp4", inicio: 10, fin: 12 }),
        segment({ archivo: "ADS-01-ESCENA-03-PARTE-02.mp4", inicio: 20, fin: 22 }),
      ],
    };
    const analyses = new Map<string, AudioAnalysis>([
      ["ADS-01-ESCENA-03-PARTE-01.mp4", { assetPath: "ADS-01-ESCENA-03-PARTE-01.mp4", provider: "test", language: "es", words: [word("hola", 10.5, 11)], silences: [] }],
      ["ADS-01-ESCENA-03-PARTE-02.mp4", { assetPath: "ADS-01-ESCENA-03-PARTE-02.mp4", provider: "test", language: "es", words: [word("mundo", 20.2, 20.8)], silences: [] }],
    ]);

    // Same transitionDurationSec as the test above, but this join is a hard
    // cut (render.ts never applies a transition within the same scene), so
    // the offset stays exactly what it'd be with no transitions at all.
    const remapped = remapWordsToEdlTimeline(edl, analyses, 0.4);

    expect(remapped[1]!.startSec).toBeCloseTo(2.2);
  });

  it("drops words that fall outside every kept segment", () => {
    const edl: Edl = { videoId: "video-1", segmentos: [segment({ archivo: "a.mp4", inicio: 10, fin: 12 })] };
    const analysis: AudioAnalysis = {
      assetPath: "a.mp4",
      provider: "test",
      language: "es",
      words: [word("antes", 5, 5.5), word("hola", 10.5, 11), word("despues", 15, 15.5)],
      silences: [],
    };

    const remapped = remapWordsToEdlTimeline(edl, new Map([["a.mp4", analysis]]));
    expect(remapped.map((w) => w.text)).toEqual(["hola"]);
  });

  it("collapses a duplicate that comes from two split transcript words falling back to the same script word", () => {
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [segment({ archivo: "a.mp4", inicio: 0, fin: 2, guionTexto: "tu ruc en sunarp" })],
    };
    const analysis: AudioAnalysis = {
      assetPath: "a.mp4",
      provider: "test",
      language: "es",
      // "sunarp" heard as two words ("su", "narb") — both would otherwise
      // fall back to the same neighboring script word ("sunarp").
      words: [word("tu", 0, 0.2), word("ruc", 0.2, 0.4), word("en", 0.4, 0.5), word("su", 0.5, 0.7), word("narb", 0.7, 0.9)],
      silences: [],
    };

    const remapped = remapWordsToEdlTimeline(edl, new Map([["a.mp4", analysis]]));
    const texts = remapped.map((w) => w.text.toLowerCase());
    // Never the same word twice in a row...
    for (let i = 1; i < texts.length; i++) expect(texts[i]).not.toBe(texts[i - 1]);
    // ...and the merged word's timing still reaches all the way to the end
    // of the audio that got folded into it, not cut off at the first half.
    const last = remapped.at(-1)!;
    expect(last.endSec).toBeCloseTo(0.9);
  });

  it("swaps in the script's own wording when the word count matches the transcript", () => {
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [
        segment({ archivo: "a.mp4", inicio: 0, fin: 2, guionTexto: "tu RUC en Sunarp" }),
      ],
    };
    const analysis: AudioAnalysis = {
      assetPath: "a.mp4",
      provider: "test",
      language: "es",
      // whisper.cpp's real mishearing of "tu RUC en Sunarp" — same word count.
      words: [word("tu", 0, 0.2), word("aria", 0.2, 0.5), word("uce", 0.5, 0.7), word("en", 0.7, 0.8), word("su", 0.8, 1)].slice(0, 4),
      silences: [],
    };

    const remapped = remapWordsToEdlTimeline(edl, new Map([["a.mp4", analysis]]));
    expect(remapped.map((w) => w.text)).toEqual(["tu", "RUC", "en", "Sunarp"]);
    expect(remapped.every((w) => !w.bajaConfianza)).toBe(true);
  });

  it("still swaps in the script's wording when the count is off by a word or two (a split acronym, say)", () => {
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [segment({ archivo: "a.mp4", inicio: 0, fin: 2, guionTexto: "tu RUC en Sunarp" })],
    };
    const analysis: AudioAnalysis = {
      assetPath: "a.mp4",
      provider: "test",
      language: "es",
      // Only 3 transcribed words for a 4-word guionTexto ("Sunarp" heard as
      // one word here, unlike the other test) — close enough to still trust.
      words: [word("tu", 0, 0.2), word("aria", 0.2, 0.5), word("uce", 0.5, 0.8)],
      silences: [],
    };

    const remapped = remapWordsToEdlTimeline(edl, new Map([["a.mp4", analysis]]));
    expect(remapped.every((w) => !w.bajaConfianza)).toBe(true);
    // Proportional mapping (3 transcript slots onto 4 script words) — every
    // word it picks has to actually come from the script, never the transcript.
    for (const w of remapped) expect(["tu", "RUC", "en", "Sunarp"]).toContain(w.text);
  });

  it("falls back to the transcript and flags low confidence when the word counts are wildly different", () => {
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [segment({ archivo: "a.mp4", inicio: 0, fin: 2, guionTexto: "tu RUC en Sunarp paso a paso hoy mismo sin falta" })],
    };
    const analysis: AudioAnalysis = {
      assetPath: "a.mp4",
      provider: "test",
      language: "es",
      // 3 transcribed words against a 10-word guionTexto — the matched span itself is untrustworthy, not just re-worded.
      words: [word("tu", 0, 0.2), word("aria", 0.2, 0.5), word("uce", 0.5, 0.8)],
      silences: [],
    };

    const remapped = remapWordsToEdlTimeline(edl, new Map([["a.mp4", analysis]]));
    expect(remapped.map((w) => w.text)).toEqual(["tu", "aria", "uce"]);
    expect(remapped.every((w) => w.bajaConfianza)).toBe(true);
  });
});

describe("groupWordsIntoBlocks", () => {
  it("groups words in chunks of the requested size", () => {
    const words = Array.from({ length: 7 }, (_, i) => resolvedWord(`w${i}`, i, i + 0.5));
    const blocks = groupWordsIntoBlocks(words, 3);
    expect(blocks.map((b) => b.text)).toEqual(["w0 w1 w2", "w3 w4 w5", "w6"]);
    expect(blocks[0]!.startSec).toBe(0);
    expect(blocks[0]!.endSec).toBe(2.5);
  });

  it("returns nothing for an empty word list", () => {
    expect(groupWordsIntoBlocks([])).toEqual([]);
  });

  it("marks a block low-confidence when any of its words are", () => {
    const words = [resolvedWord("hola", 0, 0.3), resolvedWord("aria", 0.3, 0.6, true), resolvedWord("uce", 0.6, 0.9, true)];
    const blocks = groupWordsIntoBlocks(words, 3);
    expect(blocks[0]!.bajaConfianza).toBe(true);
  });

  it("leaves a fully-confident block alone", () => {
    const words = [resolvedWord("hola", 0, 0.3), resolvedWord("mundo", 0.3, 0.6)];
    const blocks = groupWordsIntoBlocks(words, 3);
    expect(blocks[0]!.bajaConfianza).toBe(false);
  });
});

describe("wrapIntoLines", () => {
  it("keeps short text on one line", () => {
    expect(wrapIntoLines("hola mundo", 24, 2)).toEqual(["hola mundo"]);
  });

  it("wraps at a word boundary once the char limit is exceeded", () => {
    expect(wrapIntoLines("hoy te explico como sacar tu ruc", 15, 2)).toEqual(["hoy te explico", "como sacar tu ruc"]);
  });

  it("never splits a word, even if that word alone exceeds the limit", () => {
    expect(wrapIntoLines("supercalifragilisticoso", 10, 2)).toEqual(["supercalifragilisticoso"]);
  });

  it("lets the last allowed line overflow instead of dropping words past maxLines", () => {
    const lines = wrapIntoLines("una linea muy larga que no entra en dos lineas cortas de verdad", 12, 2);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toContain("verdad"); // nothing lost off the end
  });
});

describe("toSrt", () => {
  it("formats timestamps as HH:MM:SS,mmm and numbers cues from 1", () => {
    const srt = toSrt({
      videoId: "video-1",
      bloques: [
        { startSec: 0, endSec: 1.5, text: "hola mundo", words: [], bajaConfianza: false },
        { startSec: 61.2, endSec: 63, text: "segunda linea", words: [], bajaConfianza: false },
      ],
    });

    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,500\nhola mundo");
    expect(srt).toContain("2\n00:01:01,200 --> 00:01:03,000\nsegunda linea");
  });

  it("wraps a long cue across multiple SRT lines", () => {
    const srt = toSrt(
      {
        videoId: "video-1",
        bloques: [{ startSec: 0, endSec: 2, text: "hoy te explico como sacar tu ruc", words: [], bajaConfianza: false }],
      },
      15,
      2,
    );
    expect(srt).toContain("hoy te explico\ncomo sacar tu ruc");
  });
});
