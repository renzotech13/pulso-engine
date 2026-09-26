#!/usr/bin/env tsx
// Standalone: transcribes a video's own audio LOCALLY (whisper.cpp) and
// aligns it to the exact script that audio was generated from — a much
// simpler job than the guion pipeline's alignment.ts (no multi-take
// matching, no EDL: one continuous take, one known script, 1:1) — then
// burns in word-level karaoke subtitles per the preset's subtitulos config.
// Sibling of titulo-cli.ts; run it after bg-replace/titulo on a video whose
// audio track is already final.
//
// Uso:
//   tsx src/subtitulos-cli.ts <video-entrada> <video-salida> "<guion o ruta.txt>" \
//     [--preset ruta.json] [--modelo-whisper ruta.bin] [--idioma es] \
//     [--palabras-por-bloque 4]

import { readFile } from "node:fs/promises";
import path from "node:path";
import { alignWordSequences, normalizeToken, splitOriginalWords } from "./pipeline/alignment.js";
import { loadDefaultPreset, loadPreset } from "./pipeline/preset.js";
import { overlaySubtitulosSobreVideo } from "./pipeline/render.js";
import { detectSpeechBursts, groupWordsByPhrase, refineWordsWithBursts, wordsFromGuion } from "./pipeline/subtitle-sync.js";
import { WhisperCppProvider } from "./pipeline/transcription.js";
import type { SubtitleTrack } from "./pipeline/types.js";

function usageError(): never {
  console.error(
    'uso: tsx src/subtitulos-cli.ts <video-entrada> <video-salida> "<guion o ruta.txt>" ' +
      "[--preset ruta.json] [--modelo-whisper ruta.bin] [--idioma es] [--palabras-por-bloque 4]",
  );
  process.exit(1);
}

async function main() {
  const [input, output, guionArg, ...rest] = process.argv.slice(2);
  if (!input || !output || !guionArg) usageError();

  const flag = (name: string): string | undefined => {
    const idx = rest.indexOf(`--${name}`);
    return idx !== -1 && rest[idx + 1] ? rest[idx + 1] : undefined;
  };

  // Most guiones are a paragraph or two — easier to keep in a .txt file than
  // to quote correctly on a command line, but a literal string works too.
  const guionTexto = guionArg.endsWith(".txt") ? (await readFile(path.resolve(guionArg), "utf8")).trim() : guionArg;

  const modelPath = flag("modelo-whisper") ?? process.env.WHISPER_MODEL_PATH ?? "";
  if (!modelPath && !flag("bloques-json")) {
    console.error("Falta el modelo whisper — pasá --modelo-whisper <ruta.bin> o configurá WHISPER_MODEL_PATH.");
    process.exit(1);
  }
  const idioma = flag("idioma") ?? "es";

  const presetArg = flag("preset");
  const preset = presetArg ? await loadPreset(path.resolve(presetArg)) : await loadDefaultPreset();
  const palabrasPorBloqueArg = flag("palabras-por-bloque");
  const palabrasPorBloque = palabrasPorBloqueArg ? Number(palabrasPorBloqueArg) : preset.subtitulos.palabrasPorBloque;

  // Modo "bloques ya calculados": los tiempos vienen de fuera (p. ej. las ráfagas reales de voz de cada
  // escena) y NO se transcribe nada. Cada bloque solo se ve mientras se dice — nunca se adelanta texto
  // que viene después de una pausa.
  const bloquesJson = flag("bloques-json");
  if (bloquesJson) {
    const dado = JSON.parse(await readFile(path.resolve(bloquesJson), "utf8")) as { bloques: SubtitleTrack["bloques"] };
    await overlaySubtitulosSobreVideo(path.resolve(input), path.resolve(output), preset, { videoId: "standalone", bloques: dado.bloques });
    console.log(`listo: ${output}`);
    return;
  }

  console.log("transcribiendo el audio localmente (whisper.cpp)…");
  const provider = new WhisperCppProvider(modelPath);
  const transcriptWords = await provider.transcribe(path.resolve(input), idioma);

  // Swaps in the script's own (correctly spelled/accented) wording wherever
  // whisper's guess aligns to it — same tool alignment.ts already uses for
  // the guion pipeline's own subtitles, just without the EDL/segment
  // bookkeeping this simpler case doesn't need.
  const guionWords = splitOriginalWords(guionTexto);
  const alignment = alignWordSequences(
    transcriptWords.map((w) => normalizeToken(w.text)),
    guionWords.map(normalizeToken),
  );
  const resolvedWords = transcriptWords.map((w, i) => {
    const guionIndex = alignment[i];
    return {
      text: guionIndex !== null && guionIndex !== undefined ? guionWords[guionIndex]! : w.text,
      startSec: w.startSec,
      endSec: w.endSec,
      bajaConfianza: guionIndex === null || guionIndex === undefined,
      segmentIndex: 0,
    };
  });

  // Las palabras que se muestran salen del guion: si whisper junta o se salta una ("Villamaría"), igual aparece.
  const desdeGuion = wordsFromGuion(
    transcriptWords.map((w) => ({ text: w.text, startSec: w.startSec, endSec: w.endSec })),
    alignment,
    guionWords,
  );
  const palabrasFinales = desdeGuion ? desdeGuion.map((w) => ({ ...w, bajaConfianza: false, segmentIndex: 0 })) : resolvedWords;

  // lineaUnicaFluida packs/bridges lines itself at render time (see
  // Overlay.tsx's SubtitleLayer) — it needs every word in ONE block to do
  // that across the whole take, not pre-chunked by a fixed word count.
  const bloques =
    preset.subtitulos.lineaUnicaFluida && resolvedWords.length > 0
      ? [
          {
            startSec: resolvedWords[0]!.startSec,
            endSec: resolvedWords[resolvedWords.length - 1]!.endSec,
            text: resolvedWords.map((w) => w.text).join(" "),
            words: resolvedWords.map(({ text, startSec, endSec }) => ({ text, startSec, endSec })),
            bajaConfianza: resolvedWords.some((w) => w.bajaConfianza),
          },
        ]
      : groupWordsByPhrase(refineWordsWithBursts(palabrasFinales, await detectSpeechBursts(path.resolve(input))), palabrasPorBloque);
  const subtitleTrack: SubtitleTrack = { videoId: "standalone", bloques };

  console.log(`${bloques.length} bloque(s) de subtítulos armados — renderizando…`);
  await overlaySubtitulosSobreVideo(path.resolve(input), path.resolve(output), preset, subtitleTrack);

  console.log(`listo: ${output}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
