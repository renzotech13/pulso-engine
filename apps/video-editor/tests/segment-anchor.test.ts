import { describe, expect, it } from "vitest";
import { anchorSegmentOpenings, applyRetimedWords, retimeOpeningWords } from "../src/pipeline/segment-anchor.js";
import { sameSpokenWord } from "../src/pipeline/alignment.js";
import type { TranscriptionProvider } from "../src/pipeline/transcription.js";
import type { AudioAnalysis, Edl, TranscriptWord } from "../src/pipeline/types.js";

function w(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec };
}

describe("sameSpokenWord", () => {
  it("tolerates two whisper passes spelling the same word differently", () => {
    expect(sameSpokenWord("Sigueis", "¿Sigues")).toBe(true);
    expect(sameSpokenWord("Escríbenos", "escribenos")).toBe(true);
    expect(sameSpokenWord("Sin", "sin")).toBe(true);
  });

  it("does not match different words", () => {
    expect(sameSpokenWord("Sin", "con")).toBe(false);
    expect(sameSpokenWord("y", "tu")).toBe(false);
  });
});

describe("retimeOpeningWords", () => {
  it("takes the focused timings for the opening words — real ADS-01-ESCENA-03-PARTE-02", () => {
    // Full-file pass: "Sin" swallowed the untranscribed "tres, dos, uno, va".
    const segmentWords = [w("Sin", 7.06, 10.64), w("costos", 10.64, 12.06), w("escondidos", 12.06, 12.68), w("y", 12.68, 12.92)];
    // Focused pass on 7.64-13.14.
    const windowWords = [w("sin", 11.34, 11.64), w("costos", 11.64, 12.1), w("escondidos", 12.1, 12.64), w("y", 12.64, 12.92)];

    const retimed = retimeOpeningWords(segmentWords, windowWords)!;
    expect(retimed.map((r) => r.text)).toEqual(["Sin", "costos", "escondidos"]); // keeps the full-file text
    // "Sin": the passes disagree by a full second on where it ends — focused timing wins.
    expect(retimed[0]!.startSec).toBe(11.34);
    expect(retimed[0]!.endSec).toBe(11.64);
    // "costos": both passes agree on its end; its start can't precede "Sin"'s new end.
    expect(retimed[1]!.startSec).toBe(11.64);
    expect(retimed[1]!.endSec).toBe(12.06);
  });

  it("keeps the earlier start when a hallucinated word in the focused pass eats the opening word — real ADS-01-ESCENA-04", () => {
    const segmentWords = [w("Soy", 2.06, 2.4), w("Alexis", 2.72, 3.2), w("Ramos", 3.2, 3.52)];
    // Focused pass invented "Hola" (2.06-2.28) and squeezed "soy" to 2.28-2.30.
    const windowWords = [w("Hola,", 2.06, 2.28), w("soy", 2.28, 2.3), w("Alexis", 2.72, 3.2), w("Ramos", 3.2, 3.52)];
    const retimed = retimeOpeningWords(segmentWords, windowWords)!;
    expect(retimed[0]!.startSec).toBe(2.06);
  });

  it("refuses an implausibly short focused timing when the passes disagree", () => {
    const segmentWords = [w("Sin", 7.06, 10.64), w("costos", 10.64, 12.06)];
    const windowWords = [w("sin", 11.62, 11.64), w("costos", 11.64, 12.1)];
    expect(retimeOpeningWords(segmentWords, windowWords)).toBeUndefined();
  });

  it("requires the second word to follow, so a lone common first word can't match elsewhere in the window", () => {
    const segmentWords = [w("y", 5, 5.1), w("con", 5.1, 5.3)];
    const windowWords = [w("y", 3, 3.1), w("después", 3.1, 3.6), w("y", 5.0, 5.1), w("con", 5.1, 5.3)];
    expect(retimeOpeningWords(segmentWords, windowWords)![0]!.startSec).toBe(5.0);
  });

  it("returns undefined when the opening word isn't in the focused transcription", () => {
    expect(retimeOpeningWords([w("Soy", 0, 0.5), w("Alexis", 0.5, 1)], [w("hola", 0, 0.5)])).toBeUndefined();
  });
});

describe("applyRetimedWords", () => {
  it("pushes later words forward when a retimed word now ends after they start", () => {
    const words = [w("Sin", 7.06, 10.64), w("costos", 10.64, 12.06), w("y", 12.06, 12.2), w("con", 12.2, 12.4)];
    applyRetimedWords(words, 0, [w("Sin", 11.34, 11.64), w("costos", 11.64, 12.1)], 3);
    expect(words[1]!.endSec).toBe(12.1);
    expect(words[2]!.startSec).toBe(12.1);
    expect(words[3]!.startSec).toBe(12.2);
  });
});

describe("anchorSegmentOpenings", () => {
  const edl: Edl = {
    videoId: "video-1",
    segmentos: [{ archivo: "take.mp4", inicio: 6.96, fin: 13.1, lineaGuion: "Sin costos escondidos y", videoId: "video-1" }],
  };

  function analysis(): AudioAnalysis {
    return {
      assetPath: "take.mp4",
      provider: "test",
      language: "es",
      silences: [],
      words: [w("Sí.", 5.02, 7.06), w("Sin", 7.06, 10.64), w("costos", 10.64, 12.06), w("escondidos", 12.06, 12.68), w("y", 12.68, 12.92)],
    };
  }

  it("moves the segment's inicio to its first script word and re-times the analysis in place", async () => {
    const analyses = new Map([["take.mp4", analysis()]]);
    const calls: unknown[] = [];
    const provider: TranscriptionProvider = {
      name: "fake",
      transcribe: async (_path, _lang, range) => {
        calls.push(range);
        return [w("sin", 11.34, 11.64), w("costos", 11.64, 12.1), w("escondidos", 12.1, 12.64), w("y", 12.64, 12.92)];
      },
    };

    const { edl: anchored, retimedAssets } = await anchorSegmentOpenings(edl, analyses, provider, "es", 0.1);

    expect(anchored.segmentos[0]!.inicio).toBeCloseTo(11.24, 5);
    // 3s before the full-file "Sin" end.
    expect(calls).toHaveLength(1);
    expect((calls[0] as { startSec: number }).startSec).toBeCloseTo(7.64, 5);
    expect((calls[0] as { durationSec: number }).durationSec).toBe(5.5);
    expect(analyses.get("take.mp4")!.words[1]!.startSec).toBe(11.34);
    expect(analyses.get("take.mp4")!.words[0]!.text).toBe("Sí."); // outside the segment — untouched
    expect([...retimedAssets]).toEqual(["take.mp4"]);
  });

  it("leaves the segment exactly as it was when the focused transcription fails", async () => {
    const analyses = new Map([["take.mp4", analysis()]]);
    const provider: TranscriptionProvider = {
      name: "fake",
      transcribe: async () => {
        throw new Error("whisper no disponible");
      },
    };
    const { edl: anchored, retimedAssets } = await anchorSegmentOpenings(edl, analyses, provider, "es", 0.1);
    expect(anchored.segmentos[0]!.inicio).toBe(6.96);
    expect(retimedAssets.size).toBe(0);
  });
});
