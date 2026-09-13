// Section 3: presets are the brand's graphic line for subtitles and titles.
// JSON on disk for now (config/presets/*.json) — a video_presets DB table
// with tenant_id nullable=global (same pattern as render_templates) is the
// obvious Fase 3 move, once there's a UI to manage them; until then a file
// a human can hand-edit and point WHISPER... er, PRESET_PATH at is the
// right amount of infrastructure.
//
// Every property from the ticket's reference schema is here. None of them
// are ASS-route limitations (see the Fase 0 writeup on why Remotion/CSS was
// chosen) — rounded corners, per-word karaoke color, drop shadows and text
// outlines are all native CSS. The one real degradation is documented at
// UNSUPPORTED_ANIMATIONS below: it fails loud, never silently.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const hexColorWithAlpha = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "esperaba un color hex, p. ej. #FFFFFF u #000000B3");

const outlineSchema = z.object({ color: hexColorWithAlpha, grosor: z.number().nonnegative() });
const shadowSchema = z.object({ color: hexColorWithAlpha, desplazamiento: z.number().nonnegative() });
const backgroundSchema = z.object({
  activo: z.boolean(),
  color: hexColorWithAlpha,
  radio: z.number().nonnegative().default(0),
  padding: z.number().nonnegative().default(0),
});

// "pop" (scale-in bounce) is the only animation actually implemented today
// (see Overlay.tsx). Anything else validates fine here — a preset isn't
// rejected for it — but resolveAnimation() below falls back to no animation
// WITH a warning printed, per "degrada de forma explícita, nunca en
// silencio": an unknown value should never look like nothing was requested.
export const SUPPORTED_SUBTITLE_ANIMATIONS = ["pop", "ninguna"] as const;
export const SUPPORTED_TITLE_ANIMATIONS = ["fadeIn", "fadeOut", "ninguna"] as const;

const subtitulosSchema = z.object({
  tamano: z.number().positive(),
  color: hexColorWithAlpha,
  colorPalabraActiva: hexColorWithAlpha,
  contorno: outlineSchema.optional(),
  sombra: shadowSchema.optional(),
  fondo: backgroundSchema.optional(),
  posicion: z.enum(["inferior", "centro", "superior"]).default("inferior"),
  margenSeguroInferiorPx: z.number().nonnegative().default(0),
  maxCaracteresPorLinea: z.number().int().positive(),
  maxLineas: z.number().int().positive(),
  palabrasPorBloque: z.number().int().positive(),
  mayusculas: z.boolean().default(false),
  resaltarPalabraActiva: z.boolean().default(false),
  animacion: z.string().default("ninguna"),
});

const tituloSchema = z.object({
  modo: z.enum(["superpuesto", "tarjeta"]).default("superpuesto"),
  duracionSeg: z.number().positive(),
  tamano: z.number().positive(),
  color: hexColorWithAlpha,
  fondo: backgroundSchema.optional(),
  posicion: z.enum(["inferior", "centro", "superior"]).default("centro"),
  margenSeguroPx: z.number().nonnegative().default(0),
  animacionEntrada: z.string().default("ninguna"),
  animacionSalida: z.string().default("ninguna"),
  entradaSeg: z.number().nonnegative().default(0),
  salidaSeg: z.number().nonnegative().default(0),
});

// Corrige tomas grabadas en un perfil plano tipo log (S-Log3, etc.) que sin
// esto salen pálidas/desaturadas — una LUT 3D del propio fabricante de la
// cámara, no algo que este repo genere o distribuya (ver config/luts/,
// gitignored). Opcional porque no todo el metraje de un preset necesariamente
// viene de la misma cámara/perfil: un preset que la active asume que TODO su
// metraje comparte ese perfil (mezclar b-roll ya en Rec.709 con esto activo
// lo corregiría dos veces y se vería mal).
const correccionColorSchema = z.object({
  lutPath: z.string(),
});

// Limpia ruido de fondo de la voz ya concatenada (antes de mezclar música y
// normalizar volumen) con DeepFilterNet — no un filtro clásico tipo
// afftdn/arnndn, un modelo de reducción de ruido que deja la voz sonando
// mucho más cerca de un estudio. Opcional: requiere el binario `deep-filter`
// (ver DEEP_FILTER_BIN_PATH), y no todo tenant lo necesita.
const limpiezaAudioSchema = z.object({
  activo: z.boolean(),
});

// Suaviza los cortes ENTRE ESCENAS DISTINTAS con un zoom-in nativo de ffmpeg
// (ver sceneKeyForFile en alignment.ts: un guion real puede quedar dividido
// en "-PARTE-01"/"-PARTE-02" por un corte de grabación — eso sigue siendo
// corte seco, nunca transición, porque el traslape de un xfade cae justo
// sobre las palabras de esa unión). También agrega un zoom-in breve al
// inicio del video. duracionSeg se mantiene corto a propósito: un xfade más
// largo tiene más chance de traslaparse con una palabra real incluso en un
// cambio de escena — confirmado en metraje real, se comía la cola de
// "ochocientos" con 0.4s de duración.
const transicionesSchema = z.object({
  activo: z.boolean(),
  // Any ffmpeg xfade transition name (fade, zoomin, dissolve, wipeleft...).
  // Not validated against ffmpeg's own list here — an unsupported name just
  // fails loud at render time with ffmpeg's own error, same as a typo in any
  // other ffmpeg-facing preset field.
  tipo: z.string().default("fade"),
  duracionSeg: z.number().positive().default(0.15),
  zoomInicialSeg: z.number().nonnegative().default(1.2),
  // How much silence padding buildEdl keeps around each detected speech run
  // (alignment.ts's own default is 0.2s — a little breathing room around a
  // plain hard cut). A transition needs to happen exactly where speech stops
  // and starts, not into leftover silence, so this pulls that padding down
  // close to zero specifically for tenants using transitions.
  margenSilencioSeg: z.number().nonnegative().default(0.2),
});

const musicaSchema = z.object({
  volumenDb: z.number(),
  ducking: z.boolean().default(true),
  fadeInSeg: z.number().nonnegative().default(0),
  fadeOutSeg: z.number().nonnegative().default(0),
});

export const OUTPUT_FORMATS = ["9:16", "1:1", "16:9", "conservar-origen"] as const;

const salidaSchema = z.object({
  formato: z.enum(OUTPUT_FORMATS),
  resolucion: z.string().regex(/^\d+x\d+$/, "esperaba \"ANCHOxALTO\", p. ej. 1080x1920"),
  fps: z.number().int().positive(),
  crf: z.number().int().min(0).max(51),
});

export const presetSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  fuente: z.object({
    familia: z.string(),
    /** Local path or URL to a .ttf/.otf — optional, falls back to a system font stack. */
    archivo: z.string().optional(),
    peso: z.number().int().positive().default(400),
  }),
  subtitulos: subtitulosSchema,
  titulo: tituloSchema,
  correccionColor: correccionColorSchema.optional(),
  limpiezaAudio: limpiezaAudioSchema.optional(),
  transiciones: transicionesSchema.optional(),
  musica: musicaSchema,
  salida: salidaSchema,
});

export type Preset = z.infer<typeof presetSchema>;

export class PresetError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PresetError";
    this.cause = cause;
  }
}

export async function loadPreset(filePath: string): Promise<Preset> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new PresetError(`no se pudo leer el preset en "${filePath}"`, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PresetError(`el preset en "${filePath}" no es JSON válido`, err);
  }

  const result = presetSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new PresetError(`el preset en "${filePath}" no calza con el esquema:\n${issues}`);
  }
  return result.data;
}

const DEFAULT_PRESET_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "config",
  "presets",
  "default.json",
);

export async function loadDefaultPreset(): Promise<Preset> {
  return loadPreset(DEFAULT_PRESET_PATH);
}

/** Parses "1920x1080" into { width, height } — validated by salidaSchema's regex, so this never fails on well-formed input. */
export function parseResolution(resolucion: string): { width: number; height: number } {
  const [width, height] = resolucion.split("x").map(Number);
  return { width: width!, height: height! };
}

/**
 * "conservar-origen" means the preset's own resolucion/fps are placeholders
 * — the real output geometry comes from whatever the source footage
 * actually is. Every other format uses the preset's numbers as-is.
 */
export function resolveOutputSpec(
  preset: Preset,
  sourceProbe: { width: number; height: number; fps: number },
): { width: number; height: number; fps: number; crf: number } {
  if (preset.salida.formato === "conservar-origen") {
    return { width: sourceProbe.width, height: sourceProbe.height, fps: sourceProbe.fps, crf: preset.salida.crf };
  }
  return { ...parseResolution(preset.salida.resolucion), fps: preset.salida.fps, crf: preset.salida.crf };
}

/** Never silently drops an unrecognized animation — logs exactly what was asked for and what's used instead. */
export function resolveSubtitleAnimation(value: string): "pop" | "ninguna" {
  if (value === "pop" || value === "ninguna") return value;
  console.warn(
    `[video-editor] animación de subtítulo "${value}" no está soportada (soportadas: ${SUPPORTED_SUBTITLE_ANIMATIONS.join(", ")}) — se usa "ninguna".`,
  );
  return "ninguna";
}

export function resolveTitleAnimation(value: string): "fadeIn" | "fadeOut" | "ninguna" {
  if (value === "fadeIn" || value === "fadeOut" || value === "ninguna") return value;
  console.warn(
    `[video-editor] animación de título "${value}" no está soportada (soportadas: ${SUPPORTED_TITLE_ANIMATIONS.join(", ")}) — se usa "ninguna".`,
  );
  return "ninguna";
}
