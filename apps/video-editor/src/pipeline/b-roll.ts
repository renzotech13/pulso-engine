// Manifest of pre-cut "tomas de apoyo" (b-roll): support shots trimmed to
// their exact usable seconds ahead of time, instead of re-cutting from a
// long raw file every time an ad gets assembled. JSON on disk
// (config/b-roll/*.json), same pattern as config/presets/*.json — a human
// (or a future dashboard) edits it, this just validates the shape.
//
// This only describes the library; it doesn't yet feed the EDL/render
// pipeline automatically — assignAssetToScript matches files to script text,
// which doesn't apply to a b-roll insert. Wiring "use toma X here" into an
// EDL is a separate step once there's an actual need for it.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Where in the source footage the clip was trimmed from — kept even after
// cutting so a bad trim can be redone without re-scrubbing the raw file.
const fuenteSchema = z
  .object({
    archivoOriginal: z.string().min(1),
    inicioSeg: z.number().nonnegative(),
    finSeg: z.number().nonnegative(),
  })
  .refine((f) => f.finSeg > f.inicioSeg, { message: "finSeg debe ser mayor que inicioSeg" });

export const bRollClipSchema = z.object({
  id: z.string().min(1),
  /** Ruta del clip YA recortado, listo para usar — lo que el pipeline referenciaría. */
  archivo: z.string().min(1),
  /** Duración real del clip recortado. Ausente mientras `listo` sea false y todavía no exista el archivo. */
  duracionSeg: z.number().positive().optional(),
  /** false = todavía es un candidato (se sabe de dónde sale, pero no se cortó); true = el archivo en `archivo` ya existe y está listo para usarse. */
  listo: z.boolean().default(false),
  /** Tema/escena para agrupar (ej. "sunat", "oficina") — no tiene por qué calzar 1:1 con las escenas del guion. */
  escena: z.string().min(1),
  etiquetas: z.array(z.string()).default([]),
  descripcion: z.string().optional(),
  conAudio: z.boolean().default(false),
  /** Si ya pasó por el LUT/corrección de color del preset — evita corregirlo dos veces si se reusa. */
  correccionColorAplicada: z.boolean().default(false),
  fuente: fuenteSchema,
});

export const bRollLibrarySchema = z.object({
  cliente: z.string().min(1),
  tomas: z.array(bRollClipSchema),
});

export type BRollClip = z.infer<typeof bRollClipSchema>;
export type BRollLibrary = z.infer<typeof bRollLibrarySchema>;

export class BRollLibraryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "BRollLibraryError";
    this.cause = cause;
  }
}

export async function loadBRollLibrary(filePath: string): Promise<BRollLibrary> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new BRollLibraryError(`no se pudo leer la librería de b-roll en "${filePath}"`, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BRollLibraryError(`la librería de b-roll en "${filePath}" no es JSON válido`, err);
  }

  const result = bRollLibrarySchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new BRollLibraryError(`la librería de b-roll en "${filePath}" no calza con el esquema:\n${issues}`);
  }

  const ids = new Set<string>();
  for (const toma of result.data.tomas) {
    if (ids.has(toma.id)) {
      throw new BRollLibraryError(`la librería de b-roll en "${filePath}" tiene el id repetido "${toma.id}"`);
    }
    ids.add(toma.id);
  }

  return result.data;
}

// `archivo` en el manifiesto es relativo a la raíz de este paquete (donde
// vive package.json) — b-roll.ts vive en src/pipeline/, así que sube dos
// niveles — no al cwd desde el que se invoque el CLI/orquestador, para que
// un `archivo` se lea igual sin importar desde dónde se corra.
const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveBRollFilePath(clip: Pick<BRollClip, "archivo">): string {
  return path.resolve(PACKAGE_ROOT, clip.archivo);
}

/**
 * Busca una toma LISTA cuya `escena` o alguna de sus `etiquetas` calce con la
 * referencia de un requisito de guion (ej. "[fondo: sunat]" → referencia
 * "sunat"). No exige que `referencia` sea un id exacto — es exactamente el
 * vocabulario que ya existe en el manifiesto, para no inventar uno paralelo.
 */
export function findBRollByReferencia(library: BRollLibrary, referencia: string): BRollClip | undefined {
  const ref = referencia.trim().toLowerCase();
  return library.tomas.find(
    (t) => t.listo && (t.escena.toLowerCase() === ref || t.etiquetas.some((tag) => tag.toLowerCase() === ref)),
  );
}
