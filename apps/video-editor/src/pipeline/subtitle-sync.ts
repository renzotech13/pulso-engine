// Ajuste fino de los tiempos de los subtítulos de UNA toma de voz conocida. whisper.cpp con -ml 1 a veces
// deja varias palabras seguidas con el MISMO tiempo (una "corrida degenerada") cuando hay una pausa larga
// antes, y entonces "…voz. Y" queda en un bloque que se ve durante toda la pausa y la frase siguiente
// aparece tarde. Acá se corrigen dos cosas:
//   1) tiempos: se apoyan en las ráfagas reales de voz (silencedetect) — una palabra nunca empieza antes de
//      que la voz arranque ni termina después de que se corta; si los tiempos de una ráfaga son degenerados,
//      se reparten proporcional al largo de cada palabra dentro de esa ráfaga;
//   2) bloques: nunca cruzan un signo de puntuación ni una pausa.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SubtitleBlock } from "./types.js";

const exec = promisify(execFile);
const PATH_HERRAMIENTAS = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;

export interface Burst {
  start: number;
  end: number;
}
export interface TimedWord {
  text: string;
  startSec: number;
  endSec: number;
}

/** Ráfagas de voz = los tramos entre silencios (< -35 dB durante ≥ 0.15 s). */
export function burstsFromSilences(totalSec: number, silences: Burst[], minBurstSec = 0.1): Burst[] {
  const out: Burst[] = [];
  let cursor = 0;
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    if (s.start - cursor >= minBurstSec) out.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (totalSec - cursor >= minBurstSec) out.push({ start: cursor, end: totalSec });
  return out;
}

export async function detectSpeechBursts(file: string): Promise<Burst[]> {
  const env = { ...process.env, PATH: PATH_HERRAMIENTAS };
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { env });
  const total = Number(stdout.trim());
  const { stderr } = await exec("ffmpeg", ["-i", file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.15", "-f", "null", "-"], { env, maxBuffer: 16 << 20 });
  const silences: Burst[] = [];
  let start: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === "start") start = Math.max(0, Number(m[2]));
    else if (start !== null) {
      silences.push({ start, end: Number(m[2]) });
      start = null;
    }
  }
  if (start !== null) silences.push({ start, end: total }); // silencio que llega hasta el final
  return burstsFromSilences(total, silences);
}

const peso = (t: string) => Math.max(3, t.replace(/[^\p{L}\p{N}]/gu, "").length);

export function refineWordsWithBursts<T extends TimedWord>(words: readonly T[], bursts: readonly Burst[]): T[] {
  if (bursts.length === 0) return [...words];
  const burstOf = (w: TimedWord) => {
    const mid = (w.startSec + w.endSec) / 2;
    let best = 0;
    let bestDist = Infinity;
    bursts.forEach((b, i) => {
      const d = mid < b.start ? b.start - mid : mid > b.end ? mid - b.end : 0;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };
  const out = words.map((w) => ({ ...w }));
  let i = 0;
  while (i < out.length) {
    const bi = burstOf(out[i]!);
    let j = i;
    while (j + 1 < out.length && burstOf(out[j + 1]!) === bi) j++;
    const b = bursts[bi]!;
    const grupo = out.slice(i, j + 1);
    const degenerado = grupo.some((w) => w.endSec - w.startSec < 0.06) || Math.abs(grupo[0]!.startSec - b.start) > 0.3 || Math.abs(grupo.at(-1)!.endSec - b.end) > 0.5;
    if (degenerado) {
      const total = grupo.reduce((a, w) => a + peso(w.text), 0);
      let t = b.start;
      for (const w of grupo) {
        const largo = ((b.end - b.start) * peso(w.text)) / total;
        w.startSec = t;
        w.endSec = t + largo;
        t += largo;
      }
    } else {
      grupo[0]!.startSec = Math.max(grupo[0]!.startSec, b.start);
      grupo.at(-1)!.endSec = Math.min(grupo.at(-1)!.endSec, b.end);
    }
    i = j + 1;
  }
  return out;
}

/** Bloques de hasta `wordsPerBlock` palabras que NUNCA cruzan puntuación ni una pausa de más de `gapSec`. */
export function groupWordsByPhrase(words: readonly (TimedWord & { bajaConfianza?: boolean })[], wordsPerBlock: number, gapSec = 0.3): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = [];
  let chunk: (TimedWord & { bajaConfianza?: boolean })[] = [];
  const flush = () => {
    if (chunk.length === 0) return;
    blocks.push({
      startSec: chunk[0]!.startSec,
      endSec: chunk.at(-1)!.endSec,
      text: chunk.map((w) => w.text).join(" "),
      words: chunk.map(({ text, startSec, endSec }) => ({ text, startSec, endSec })),
      bajaConfianza: chunk.some((w) => w.bajaConfianza === true),
    });
    chunk = [];
  };
  for (const w of words) {
    const prev = chunk.at(-1);
    if (prev && (chunk.length >= wordsPerBlock || /[.,;:?!…]["')»]?$/.test(prev.text) || w.startSec - prev.endSec > gapSec)) flush();
    chunk.push(w);
  }
  flush();
  return blocks;
}

const letras = (t: string) => t.normalize("NFD").replace(/[^\p{L}\p{N}]/gu, "").length;

/**
 * Palabras de los subtítulos tomadas del GUION (no de lo que whisper transcribió): si whisper junta dos
 * palabras ("Villamaría") o se salta una, esa palabra igual se muestra. Las palabras del guion sin
 * correspondencia se reparten, según el largo de cada una, dentro del tramo de la palabra transcrita vecina
 * que las "absorbió" (la que tiene letras de más: "Villamaría" absorbe a "Villa"); si ninguna absorbió, van con la anterior.
 * Devuelve null si el alineamiento cubre menos de la mitad del guion (mejor usar la transcripción tal cual).
 */
export function wordsFromGuion(transcript: readonly TimedWord[], alignment: readonly (number | null)[], guion: readonly string[]): TimedWord[] | null {
  const span: ({ start: number; end: number } | null)[] = guion.map(() => null);
  const largoTranscrito: number[] = guion.map(() => 0);
  transcript.forEach((w, i) => {
    const g = alignment[i];
    if (g === null || g === undefined) return;
    const sp = span[g];
    span[g] = sp ? { start: Math.min(sp.start, w.startSec), end: Math.max(sp.end, w.endSec) } : { start: w.startSec, end: w.endSec };
    largoTranscrito[g]! += letras(w.text);
  });
  const anchors = span.flatMap((sp, g) => (sp ? [g] : []));
  if (anchors.length === 0 || anchors.length < guion.length * 0.5) return null;

  // grupos[k] = [desde, hasta) de guion que comparten el tramo del ancla k
  const grupos = anchors.map((a) => ({ desde: a, hasta: a + 1 }));
  anchors.forEach((a, k) => {
    const sig = k + 1 < anchors.length ? anchors[k + 1]! : guion.length;
    if (sig - a - 1 <= 0) return; // sin palabras sueltas entre estas dos anclas
    const sueltas = Array.from({ length: sig - a - 1 }, (_, n) => a + 1 + n);
    const largoSueltas = sueltas.reduce((x, g) => x + letras(guion[g]!), 0);
    const exceso = (g: number) => largoTranscrito[g]! - letras(guion[g]!);
    const alSiguiente = k + 1 < anchors.length && exceso(anchors[k + 1]!) >= 0.6 * largoSueltas && exceso(anchors[k + 1]!) > exceso(a);
    if (alSiguiente) grupos[k + 1]!.desde = a + 1;
    else grupos[k]!.hasta = sig;
  });
  grupos[0]!.desde = 0;

  const out: TimedWord[] = guion.map((text) => ({ text, startSec: 0, endSec: 0 }));
  grupos.forEach((gr, k) => {
    const sp = span[anchors[k]!]!;
    const idx = Array.from({ length: gr.hasta - gr.desde }, (_, n) => gr.desde + n);
    const pesos = idx.map((g) => peso(guion[g]!));
    const suma = pesos.reduce((x, y) => x + y, 0);
    const siguiente = k + 1 < anchors.length ? span[anchors[k + 1]!]!.start : Infinity;
    const fin = idx.length === 1 ? sp.end : Math.max(sp.end, Math.min(siguiente, sp.start + 0.07 * suma));
    let t = sp.start;
    idx.forEach((g, n) => {
      const largo = ((fin - sp.start) * pesos[n]!) / suma;
      out[g]!.startSec = t;
      out[g]!.endSec = t + largo;
      t += largo;
    });
  });
  return out;
}
