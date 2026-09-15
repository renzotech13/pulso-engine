import { describe, expect, it } from "vitest";
import { dtwPresetForModel, repairDegenerateTimestamps } from "../src/pipeline/transcription.js";
import type { TranscriptWord } from "../src/pipeline/types.js";

function w(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec };
}

describe("repairDegenerateTimestamps", () => {
  it("leaves normally-timed words untouched", () => {
    const words = [w("hola", 0, 0.3), w("mundo", 0.3, 0.7)];
    expect(repairDegenerateTimestamps(words)).toEqual(words);
  });

  it("spreads a run of words that share the exact same offsets across the gap to the next distinct word — real whisper.cpp output on a repeated retake", () => {
    // Confirmed on ADS-01-ESCENA-05.MP4's second take: everything up to
    // "de" collapsed onto 14.68, then "de" through "conviene." had real
    // timestamps again — except "de" itself started at that same 14.68,
    // overlapping whatever the run got spread into (fixed by the final
    // monotonic pass below, not by leaving "de" untouched).
    const words = [
      w("Escríbenos", 14.68, 14.68),
      w("al", 14.68, 14.68),
      w("Whatsapp", 14.68, 14.68),
      w("y", 14.68, 14.68),
      w("te", 14.68, 14.68),
      w("diremos", 14.68, 14.68),
      w("qué", 14.68, 14.68),
      w("tipo", 14.68, 14.68),
      w("de", 14.68, 14.74),
      w("empresa", 14.74, 15.52),
      w("te", 15.52, 16.04),
      w("conviene.", 16.04, 18.28),
    ];

    const repaired = repairDegenerateTimestamps(words);

    // Same words, same order, nothing dropped.
    expect(repaired.map((r) => r.text)).toEqual(words.map((r) => r.text));
    // Every word starts no earlier than the previous one's end — including
    // "de", which is the actual bug: it used to overlap the repaired run.
    for (let i = 1; i < repaired.length; i++) {
      expect(repaired[i]!.startSec).toBeGreaterThanOrEqual(repaired[i - 1]!.endSec);
      expect(repaired[i]!.endSec).toBeGreaterThan(repaired[i]!.startSec);
    }
    expect(repaired[0]!.startSec).toBe(14.68);
    // The legitimately-timed tail ("empresa" onward) is barely nudged, not
    // dragged out by seconds — a tight fix, not a blunt one.
    expect(repaired[10]!.startSec).toBeCloseTo(15.52, 1);
    expect(repaired[11]!.endSec).toBeCloseTo(18.28, 1);
  });

  it("gives a degenerate run at the very end of the transcript a sensible fallback spread instead of staying zero-width", () => {
    const words = [w("hola", 0, 0.3), w("chau", 5, 5), w("adiós", 5, 5)];
    const repaired = repairDegenerateTimestamps(words);

    expect(repaired[0]).toEqual(words[0]);
    expect(repaired[1]!.startSec).toBe(5);
    expect(repaired[2]!.startSec).toBeGreaterThan(repaired[1]!.startSec);
    expect(repaired[2]!.endSec).toBeGreaterThan(repaired[2]!.startSec);
  });

  it("does not touch a single word that merely happens to have zero duration on its own (not part of a run)", () => {
    const words = [w("uno", 0, 0), w("dos", 1, 1.4)];
    expect(repairDegenerateTimestamps(words)).toEqual(words);
  });
});

describe("dtwPresetForModel", () => {
  it("maps standard whisper.cpp model filenames to their DTW preset", () => {
    expect(dtwPresetForModel("/models/ggml-small.bin")).toBe("small");
    expect(dtwPresetForModel("ggml-base.en.bin")).toBe("base.en");
    expect(dtwPresetForModel("ggml-large-v3-turbo-q5_0.bin")).toBe("large.v3.turbo");
    expect(dtwPresetForModel("ggml-large-v3.bin")).toBe("large.v3");
  });

  it("returns undefined for a non-standard filename, so the caller falls back to non-DTW timing", () => {
    expect(dtwPresetForModel("/models/mi-modelo-custom.bin")).toBeUndefined();
  });
});
