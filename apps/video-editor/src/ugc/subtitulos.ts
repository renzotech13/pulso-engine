// Subtítulos por palabra sobre un video ya armado (con su voz), con los presets aprobados de config/estilos/subtitulos.
// El texto que se muestra sale del guion exacto (subtitulos-cli lo alinea con whisper); la marca de la firma es editable.
// Zona segura: los tres estilos van en una franja central (entre el título y el precio), con tamaño reducido.

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SubtituloEstilo } from "@pulso/shared/ugc";

const exec = promisify(execFile);
const VIDEO_EDITOR_DIR = path.resolve(import.meta.dirname, "../..");
const ESTILOS = path.join(VIDEO_EDITOR_DIR, "config/estilos");
const WHISPER_MODEL = process.env.WHISPER_MODEL_PATH ?? path.join(VIDEO_EDITOR_DIR, "models/ggml-small.bin");
const PATH_HERRAMIENTAS = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;

const ARCHIVO: Record<SubtituloEstilo, string> = {
  "black-centro": "az-subtitulos-black",
  "abajo-az": "az-subtitulos-ads",
  aura: "aura-subtitulos",
};

export interface SubtitulosOpts {
  workDir: string;
  entrada: string;
  salida: string;
  estilo: SubtituloEstilo;
  /** Texto exacto de la voz (sin etiquetas [..]). */
  guion: string;
  formato: "9:16" | "4:5";
  marca: { texto: string; acento: string; colorAcento: string };
  /** Palabras por fila y color de la palabra activa; si no se pasan, valen los del estilo. */
  palabrasPorFila?: number | undefined;
  colorResalte?: string | undefined;
}

export function limpiarGuionParaSubtitulos(guion: string): string {
  return guion
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/treinta\s*y\s*nueve\s+con\s+noventa/gi, "39,90") // el subtítulo muestra el precio como número
    .replace(/\s+/g, " ")
    .trim();
}

export async function aplicarSubtitulos(o: SubtitulosOpts): Promise<void> {
  const base = JSON.parse(await readFile(path.join(ESTILOS, "_base.json"), "utf8")) as Record<string, unknown>;
  const estilo = JSON.parse(await readFile(path.join(ESTILOS, "subtitulos", `${ARCHIVO[o.estilo]}.json`), "utf8")) as { subtitulos: Record<string, unknown> };
  const sub: Record<string, unknown> = { ...estilo.subtitulos };

  // Las tres opciones van en la MISMA franja, entre el título (arriba) y el precio/WhatsApp (abajo), para que no se pisen:
  // "superior" con margen = coordenada y donde empieza el texto (9:16: 700 → texto entre ≈700 y 860; 4:5: 430).
  sub.posicion = "superior";
  sub.margenSeguroInferiorPx = o.formato === "4:5" ? 430 : 700;
  if (o.estilo === "black-centro") {
    sub.tamano = 60; // 74 px se sale de la zona segura con 3 palabras largas
    sub.maxCaracteresPorLinea = 24;
    if (o.marca.texto) {
      const m = (sub.marca as Record<string, unknown> | undefined) ?? { tamano: 40, color: "#FFFFFF", margenSuperiorPx: -6 };
      sub.marca = { ...m, tamano: 34, texto: o.marca.texto, acento: o.marca.acento, colorAcento: o.marca.colorAcento };
    } else {
      delete sub.marca; // sin nombre de marca no hay firma
    }
  } else {
    sub.tamano = 50;
    delete sub.marca;
  }

  if (o.palabrasPorFila) {
    sub.palabrasPorBloque = o.palabrasPorFila;
    sub.lineaUnicaFluida = false; // la fila fluida junta todas las palabras que caben; con N palabras por fila hay que agrupar de a N
    sub.maxCaracteresPorLinea = Math.min(Number(sub.maxCaracteresPorLinea ?? 26), o.palabrasPorFila * 9);
  }
  if (o.colorResalte) {
    sub.colorPalabraActiva = o.colorResalte;
    const fondo = sub.fondoPalabraActiva as Record<string, unknown> | undefined;
    if (fondo) sub.fondoPalabraActiva = { ...fondo, color: o.colorResalte };
  }

  const preset = path.join(o.workDir, "preset-subtitulos.json");
  await writeFile(preset, JSON.stringify({ ...base, subtitulos: sub }));
  const guion = path.join(o.workDir, "guion-subtitulos.txt");
  await writeFile(guion, limpiarGuionParaSubtitulos(o.guion));
  await exec("npx", ["tsx", "src/subtitulos-cli.ts", o.entrada, o.salida, guion, "--preset", preset, "--modelo-whisper", WHISPER_MODEL], {
    cwd: VIDEO_EDITOR_DIR,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: PATH_HERRAMIENTAS },
  });
}
