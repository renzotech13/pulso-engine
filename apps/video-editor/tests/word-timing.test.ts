import { describe, expect, it } from "vitest";
import { assembleWordsFromDtwTokens, assignWordStarts, type DtwToken } from "../src/pipeline/word-timing.js";

const WINDOW = 0.02;

/** Envelope at WINDOW resolution: `loud` spans get 0.17, everything else 0.025 (the AZ room-tone level). */
function envelope(durationSec: number, loud: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (let i = 0; i * WINDOW < durationSec; i++) {
    const t = i * WINDOW;
    out.push(loud.some(([a, b]) => t >= a && t < b) ? 0.17 : 0.025);
  }
  return out;
}

describe("assembleWordsFromDtwTokens", () => {
  it("merges subword tokens and keeps punctuation from moving a word's end — real ADS-01-ESCENA-01 tokens", () => {
    const tokens: DtwToken[] = [
      { text: " Grab", endSec: 0.28 },
      { text: "ando", endSec: 0.5 },
      { text: " en", endSec: 0.66 },
      { text: " 3", endSec: 0.84 },
      { text: ",", endSec: 0.98 },
      { text: " ac", endSec: 1.78 },
      { text: "ción", endSec: 2.02 },
      { text: ".", endSec: 2.48 },
      { text: " S", endSec: 2.54 },
      { text: "igues", endSec: 2.76 },
    ];
    expect(assembleWordsFromDtwTokens(tokens).map(({ text, endSec }) => ({ text, endSec }))).toEqual([
      { text: "Grabando", endSec: 0.5 },
      { text: "en", endSec: 0.66 },
      { text: "3,", endSec: 0.84 },
      // "." sits a whole pause later (2.48) — it must not stretch "acción" over that silence.
      { text: "acción.", endSec: 2.02 },
      { text: "Sigues", endSec: 2.76 },
    ]);
  });

  it("carries opening punctuation into the word that follows it", () => {
    const tokens: DtwToken[] = [
      { text: " ¡", endSec: 1.0 },
      { text: "Ac", endSec: 1.2 },
      { text: "ción", endSec: 1.5 },
    ];
    expect(assembleWordsFromDtwTokens(tokens).map((w) => w.text)).toEqual(["¡Acción"]);
  });
});

describe("onset bound", () => {
  it("ignores a first token that DTW placed seconds before the rest of its word — real ADS-01-ESCENA-05 tokens", () => {
    const [word] = assembleWordsFromDtwTokens([
      { text: " Es", endSec: 9.94 },
      { text: "cr", endSec: 14.92 },
      { text: "í", endSec: 14.96 },
      { text: "ben", endSec: 15.04 },
      { text: "os", endSec: 15.16 },
    ]);
    // Anchored on "cr" (14.92) minus the time "Escr" takes, not on the stray 9.94.
    expect(word!.onsetBoundSec).toBeGreaterThan(14.4);
    expect(word!.onsetBoundSec).toBeLessThan(14.6);
  });

  it("stops a word from swallowing speech before it when the audio has no pause to find", () => {
    // Previous word ends at 3.48; continuous loud audio (someone talking off-script,
    // untranscribed) all the way to "Escríbenos" ending at 15.16.
    const words = assembleWordsFromDtwTokens([
      { text: " conviene", endSec: 3.48 },
      { text: " Es", endSec: 9.94 },
      { text: "cr", endSec: 14.92 },
      { text: "íbenos", endSec: 15.16 },
    ]);
    const timed = assignWordStarts(words, envelope(16, [[0, 16]]), WINDOW);
    expect(timed[1]!.startSec).toBeGreaterThan(14.4); // not 3.48
  });
});

describe("assignWordStarts", () => {
  it("starts a word right after the pause before it, not at the previous word's end — real ADS-01-ESCENA-04 shape", () => {
    // Director's countdown ("Yo" in whisper's text) until ~1.65s, a pause,
    // "soy" 2.05-2.30, a pause, "Alexis Ramos" 2.70-3.55. DTW ends from the
    // real run: Yo 1.54, soy 2.40, Alexis 3.20, Ramos 3.52.
    const env = envelope(4, [
      [0.35, 0.55],
      [0.8, 1.65],
      [2.05, 2.3],
      [2.7, 3.55],
    ]);
    const words = assignWordStarts(
      [
        { text: "Yo", endSec: 1.54 },
        { text: "soy", endSec: 2.4 },
        { text: "Alexis", endSec: 3.2 },
        { text: "Ramos", endSec: 3.52 },
      ],
      env,
      WINDOW,
    );

    expect(words[1]!.startSec).toBeCloseTo(2.06, 1); // "soy" — this is where the clip must start
    expect(words[2]!.startSec).toBeCloseTo(2.7, 1); // "Alexis", after the second pause
    expect(words[3]!.startSec).toBeCloseTo(3.2, 5); // "Ramos" — no pause, continues from "Alexis"
  });

  it("does not treat a short closure inside a word as a pause", () => {
    // "acción" with a 60ms "k" closure at 1.20 — below MIN_PAUSE_SEC.
    const env = envelope(2, [
      [0.8, 1.2],
      [1.26, 1.65],
    ]);
    const [word] = assignWordStarts([{ text: "acción", endSec: 1.6 }], env, WINDOW);
    expect(word!.startSec).toBeCloseTo(0.8, 1);
  });

  it("falls back to the previous word's end when there's no audio envelope to look at", () => {
    const words = assignWordStarts(
      [
        { text: "hola", endSec: 0.5 },
        { text: "mundo", endSec: 1.0 },
      ],
      [],
      WINDOW,
    );
    expect(words).toEqual([
      { text: "hola", startSec: 0, endSec: 0.5 },
      { text: "mundo", startSec: 0.5, endSec: 1.0 },
    ]);
  });
});
