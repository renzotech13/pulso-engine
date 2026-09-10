import { describe, expect, it } from "vitest";
import { groupWordsIntoBlocks, remapWordsToEdlTimeline, toSrt } from "../src/pipeline/subtitles.js";
import type { AudioAnalysis, Edl, TranscriptWord } from "../src/pipeline/types.js";

function word(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec };
}

describe("remapWordsToEdlTimeline", () => {
  it("shifts a word's time by how far its segment sits into the OUTPUT timeline", () => {
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [
        { archivo: "a.mp4", inicio: 10, fin: 12, lineaGuion: "hola", videoId: "video-1" },
        { archivo: "a.mp4", inicio: 20, fin: 22, lineaGuion: "mundo", videoId: "video-1" },
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

  it("drops words that fall outside every kept segment", () => {
    const edl: Edl = {
      videoId: "video-1",
      segmentos: [{ archivo: "a.mp4", inicio: 10, fin: 12, lineaGuion: "hola", videoId: "video-1" }],
    };
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
});

describe("groupWordsIntoBlocks", () => {
  it("groups words in chunks of the requested size", () => {
    const words = Array.from({ length: 7 }, (_, i) => word(`w${i}`, i, i + 0.5));
    const blocks = groupWordsIntoBlocks(words, 3);
    expect(blocks.map((b) => b.text)).toEqual(["w0 w1 w2", "w3 w4 w5", "w6"]);
    expect(blocks[0]!.startSec).toBe(0);
    expect(blocks[0]!.endSec).toBe(2.5);
  });

  it("returns nothing for an empty word list", () => {
    expect(groupWordsIntoBlocks([])).toEqual([]);
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
});
