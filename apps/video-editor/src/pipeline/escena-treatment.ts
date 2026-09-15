// Turns a script's per-escena visual requisitos ("[fondo: sunat]",
// "[apoyo: oficina]") into actual replacement video files, BEFORE any of
// them reach the normal pipeline (probe → transcribe → align → render).
// Everything downstream keeps working exactly as it does today — it just
// receives a differently-prepared raw take at a new path, never knowing a
// swap happened. This is what lets the orchestrator (processProject) stay
// unaware of RVM/b-roll entirely: it only ever sees a video path.

import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@pulso/shared/logger";
import { findBRollByReferencia, loadBRollLibrary, resolveBRollFilePath } from "./b-roll.js";
import { replaceBackgroundSplit, type BackgroundReplaceOptions } from "./background-replace.js";
import type { EscenaGuion } from "./types.js";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const logger = createLogger({ agent: "video-editor" });

// Matches the crew's own file-naming convention ("ADS-01-ESCENA-04.MP4",
// "BLOQUE-02-ADS-04-ESCENA-02.MP4") — the same one sceneKeyForFile relies
// on in alignment.ts — so a script's "Escena 4" lines up with whichever
// physical file(s) actually contain "ESCENA-4" in their name, regardless of
// what else is in the filename.
const ESCENA_IN_FILENAME = /escena-?(\d+)/i;

export function escenaNumberForFile(filePath: string): number | undefined {
  const match = ESCENA_IN_FILENAME.exec(path.basename(filePath));
  return match ? Number(match[1]) : undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Mux del video de apoyo (loopeado si hace falta) con el audio ORIGINAL de la toma — la línea hablada se sigue escuchando mientras la pantalla muestra otra cosa por completo. */
async function overlayApoyo(originalTakePath: string, brollPath: string, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        brollPath,
        "-i",
        originalTakePath,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-shortest",
        outputPath,
      ],
      { maxBuffer: MAX_BUFFER },
    );
  } catch (err) {
    throw new Error(`no se pudo superponer la toma de apoyo "${brollPath}" sobre "${originalTakePath}"`, { cause: err });
  }
}

export interface ApplyEscenaTreatmentsOptions {
  bRollLibraryPath: string;
  /** Carpeta donde se escriben las tomas ya tratadas (fondo/apoyo aplicados). */
  workDir: string;
  /** Necesario solo si alguna escena pide "fondo" — sin esto, esos requisitos se omiten con un warning. */
  rvmModelPath?: string | undefined;
  backgroundReplace?:
    | Pick<BackgroundReplaceOptions, "cutPositionFrac" | "blendBandFrac" | "workWidth" | "outputFps">
    | undefined;
  /** true = re-trata aunque ya exista un archivo tratado con ese nombre — mismo espíritu que el --force del resto del pipeline. */
  force?: boolean | undefined;
}

/**
 * Dado el listado de tomas crudas de UN guion y sus escenas, devuelve una
 * lista equivalente donde cada toma cuya escena trae un requisito visual fue
 * reemplazada por una versión tratada. Una toma sin escena reconocible en su
 * nombre, o cuya escena no pide nada especial, pasa sin tocar. Un requisito
 * que no se puede cumplir (sin b-roll listo, sin modelo RVM configurado,
 * tipo no reconocido) se omite con un warning — nunca frena el resto del
 * render por una toma de apoyo que todavía no está lista.
 */
export async function applyEscenaTreatments(
  videoPaths: readonly string[],
  escenas: readonly EscenaGuion[],
  options: ApplyEscenaTreatmentsOptions,
): Promise<string[]> {
  if (escenas.length === 0) return [...videoPaths];

  const library = await loadBRollLibrary(options.bRollLibraryPath);
  const escenasByNumero = new Map(escenas.map((e) => [e.numero, e]));

  const result: string[] = [];
  for (const videoPath of videoPaths) {
    const numero = escenaNumberForFile(videoPath);
    const escena = numero !== undefined ? escenasByNumero.get(numero) : undefined;
    if (!escena || escena.requisitos.length === 0) {
      result.push(videoPath);
      continue;
    }

    let currentPath = videoPath;
    for (const requisito of escena.requisitos) {
      const broll = findBRollByReferencia(library, requisito.referencia);
      if (!broll) {
        logger.warn(
          { videoPath, requisito },
          `no hay ninguna toma de apoyo LISTA con la etiqueta "${requisito.referencia}" — se usa la toma sin tratar`,
        );
        continue;
      }
      const brollPath = resolveBRollFilePath(broll);

      // El nombre conserva el de la toma original como prefijo, así
      // escenaNumberForFile sigue reconociendo la escena en el archivo
      // tratado. Nota: si el original usaba el sufijo "-PARTE-N" que agrupa
      // retakes de una misma escena (sceneKeyForFile), ese sufijo deja de
      // quedar al final del nombre — cada toma tratada termina siendo su
      // propia escena para efectos de transición. No es un problema hoy
      // (ninguna escena con requisitos tiene partes), pero vale saberlo.
      const treatedPath = path.join(
        options.workDir,
        `${path.basename(videoPath, path.extname(videoPath))}-${requisito.tipo}-${broll.id}.mp4`,
      );

      const alreadyTreated = !options.force && (await fileExists(treatedPath));
      if (alreadyTreated) {
        currentPath = treatedPath;
        continue;
      }

      if (requisito.tipo === "fondo") {
        if (!options.rvmModelPath) {
          logger.warn({ videoPath, requisito }, 'requisito "fondo" pedido pero no hay un modelo RVM configurado — se omite');
          continue;
        }
        await replaceBackgroundSplit(
          currentPath,
          brollPath,
          {
            cutPositionFrac: options.backgroundReplace?.cutPositionFrac ?? 0.5,
            blendBandFrac: options.backgroundReplace?.blendBandFrac ?? 0.15,
            workWidth: options.backgroundReplace?.workWidth ?? 1080,
            ...(options.backgroundReplace?.outputFps !== undefined
              ? { outputFps: options.backgroundReplace.outputFps }
              : {}),
            modelPath: options.rvmModelPath,
          },
          treatedPath,
        );
      } else if (requisito.tipo === "apoyo") {
        await overlayApoyo(currentPath, brollPath, treatedPath);
      } else {
        logger.warn({ videoPath, requisito }, `tipo de requisito "${requisito.tipo}" no reconocido — se ignora`);
        continue;
      }

      currentPath = treatedPath;
    }

    result.push(currentPath);
  }

  return result;
}
