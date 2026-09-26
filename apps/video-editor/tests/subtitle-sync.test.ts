import { describe, expect, it } from "vitest";
import { burstsFromSilences, groupWordsByPhrase, refineWordsWithBursts, wordsFromGuion } from "../src/pipeline/subtitle-sync.js";

const w = (text: string, startSec: number, endSec: number) => ({ text, startSec, endSec });

describe("subtitle-sync", () => {
  it("convierte silencios en ráfagas de voz", () => {
    expect(burstsFromSilences(10, [{ start: 2, end: 4.8 }, { start: 6.7, end: 7.5 }])).toEqual([
      { start: 0, end: 2 },
      { start: 4.8, end: 6.7 },
      { start: 7.5, end: 10 },
    ]);
  });

  it("reparte una corrida degenerada dentro de su ráfaga (caso 'Y no le hizo falta')", () => {
    const bursts = [{ start: 0, end: 2.1 }, { start: 4.85, end: 6.7 }];
    const palabras = [w("voz.", 1.92, 2.3), w("Y", 4.8, 4.8), w("no", 4.8, 4.8), w("le", 4.8, 4.8), w("hizo", 4.8, 4.8), w("falta", 4.8, 4.86)];
    const r = refineWordsWithBursts(palabras, bursts);
    expect(r[0]!.endSec).toBeLessThanOrEqual(2.1); // "voz." no invade la pausa
    expect(r[1]!.startSec).toBeCloseTo(4.85, 2); // "Y" arranca cuando vuelve la voz
    expect(r[5]!.endSec).toBeCloseTo(6.7, 2);
    for (let i = 2; i < r.length; i++) expect(r[i]!.startSec).toBeGreaterThan(r[i - 1]!.startSec);
  });

  it("los bloques no cruzan puntuación: '…voz.' termina el bloque y 'Y no' abre otro", () => {
    const palabras = [w("levantar", 1, 1.5), w("la", 1.5, 1.6), w("voz.", 1.6, 2.1), w("Y", 4.85, 4.95), w("no", 4.95, 5.1), w("le", 5.1, 5.2)];
    expect(groupWordsByPhrase(palabras, 2).map((b) => b.text)).toEqual(["levantar la", "voz.", "Y no", "le"]);
  });

  it("tampoco cruzan una pausa aunque no haya punto", () => {
    const palabras = [w("uno", 0, 0.3), w("dos", 1.5, 1.8)];
    expect(groupWordsByPhrase(palabras, 3).map((b) => b.text)).toEqual(["uno", "dos"]);
  });

  it("no pierde 'Villa' cuando whisper la junta con la siguiente ('Villamaría')", () => {
    const guion = ["Lima", "con", "Tejada.", "Villa", "María", "del", "Triunfo"];
    const tr = [w("Lima", 28.7, 28.79), w("con", 28.79, 28.92), w("Tejada,", 28.92, 29.8), w("Villamaría", 30.1, 30.6), w("del", 30.6, 30.81), w("triunfo", 30.81, 31.3)];
    const r = wordsFromGuion(tr, [0, 1, 2, 4, 5, 6], guion)!;
    expect(r.map((x) => x.text)).toEqual(guion);
    expect(r[3]!.startSec).toBeCloseTo(30.1, 2);
    expect(r[3]!.endSec).toBeLessThanOrEqual(r[4]!.startSec + 1e-6);
    expect(r[4]!.endSec).toBeLessThanOrEqual(r[5]!.startSec + 1e-6);
  });

  it("también cuando 'Villamaría' quedó alineada con 'Villa'", () => {
    const guion = ["Lima", "con", "Tejada.", "Villa", "María", "del", "Triunfo"];
    const tr = [w("Lima", 28.7, 28.79), w("con", 28.79, 28.92), w("Tejada,", 28.92, 29.8), w("Villamaría", 30.1, 30.6), w("del", 30.6, 30.81), w("triunfo", 30.81, 31.3)];
    const r = wordsFromGuion(tr, [0, 1, 2, 3, 5, 6], guion)!;
    expect(r.map((x) => x.text)).toEqual(guion);
    expect(r[3]!.startSec).toBeCloseTo(30.1, 2);
    expect(r[4]!.endSec).toBeCloseTo(30.6, 2);
  });
});
