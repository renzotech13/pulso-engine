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
// `blur` (px, default 4) y `halo` (segunda capa difusa alrededor de la letra) son opcionales: solo la sombra 'fuerte' los usa.
const shadowSchema = z.object({
  color: hexColorWithAlpha,
  desplazamiento: z.number().nonnegative(),
  blur: z.number().nonnegative().optional(),
  halo: z.boolean().optional(),
  // Extra tight, low-blur layer right at the glyph edge, UNDER the soft
  // `blur`/`halo` glow — that pair alone only ever spreads out (more blur =
  // more reach but thinner-looking), it can't add a dense, solid-reading
  // core the way this does. Omit for the old 1-2-layer look untouched.
  grosorPx: z.number().nonnegative().optional(),
});
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
// "wipeVertical" is the same masked-reveal mechanism for both directions —
// entrance grows the visible area top-down, salida shrinks it back the same
// way (see Overlay.tsx's titleLineClipPath) — so it's valid for either field,
// unlike fadeIn/fadeOut which only make sense on their own side.
export const SUPPORTED_TITLE_ANIMATIONS = ["fadeIn", "fadeOut", "wipeVertical", "ninguna"] as const;
export const SUPPORTED_TITLE_STYLES = ["simple", "tresNiveles"] as const;
// A "tresNiveles" level's OWN entrance/exit effect — takes over from the
// título's shared animacionEntrada/animacionSalida for that one level when
// set to anything but "ninguna" (which falls back to the shared behavior,
// same as before this existed). See Overlay.tsx for what each one does.
export const SUPPORTED_NIVEL_EFECTOS = ["ninguna", "mascaraVertical", "letrasOla", "letrasJuntan"] as const;

const fuenteSchema = z.object({
  familia: z.string(),
  /** Local path or URL to a .ttf/.otf — optional, falls back to a system font stack. */
  archivo: z.string().optional(),
  peso: z.number().int().positive().default(400),
});

// The "karaoke pill" look — a colored, rounded box drawn BEHIND whichever
// word is being spoken right now (vs. resaltarPalabraActiva's plain color
// swap, which stays available and is what renders when this is absent/off).
// `colorTexto` is separate from subtitulos.colorPalabraActiva because a
// pill's own background is usually a bright/saturated color that a light
// text color would wash out against — needs its own (typically dark) text
// color to stay legible sitting on top of it.
const fondoPalabraActivaSchema = z.object({
  activo: z.boolean(),
  color: hexColorWithAlpha,
  colorTexto: hexColorWithAlpha,
  radio: z.number().nonnegative().default(0),
  // Reserved as real padding on EVERY word (transparent when inactive,
  // this color when active) — not just the active one — specifically so
  // the padding itself never changes: only backgroundColor/color flip.
  // Applying padding to just the active word was tried first and
  // rejected: it grows that one word's own box the instant it activates,
  // shifting it (and only it) down off the shared text baseline —
  // confirmed on a real render. Reserving the same space always is what
  // keeps every word's size/position/line-height identical regardless of
  // which one is active right now.
  paddingX: z.number().nonnegative().default(0),
  paddingY: z.number().nonnegative().default(0),
});

const subtitulosSchema = z.object({
  tamano: z.number().positive(),
  color: hexColorWithAlpha,
  colorPalabraActiva: hexColorWithAlpha,
  contorno: outlineSchema.optional(),
  sombra: shadowSchema.optional(),
  fondo: backgroundSchema.optional(),
  // Overrides the preset's top-level `fuente` for subtitles only — a
  // karaoke-caption typeface (often a bold serif) is routinely different
  // from whatever the título/brand font is. Falls back to the top-level
  // `fuente` when absent, same as before this existed.
  fuente: fuenteSchema.optional(),
  fondoPalabraActiva: fondoPalabraActivaSchema.optional(),
  posicion: z.enum(["inferior", "centro", "superior"]).default("inferior"),
  margenSeguroInferiorPx: z.number().nonnegative().default(0),
  maxCaracteresPorLinea: z.number().int().positive(),
  maxLineas: z.number().int().positive(),
  palabrasPorBloque: z.number().int().positive(),
  mayusculas: z.boolean().default(false),
  resaltarPalabraActiva: z.boolean().default(false),
  animacion: z.string().default("ninguna"),
  // Opt-in alternate layout: ignores maxCaracteresPorLinea/maxLineas and
  // instead packs each block's own words into real, canvas-measured single
  // lines (never 2) at render time, with consecutive lines made contiguous
  // — a line stays up until the NEXT one's first word starts, so a mid-take
  // pause never reads as the subtitle vanishing. Off by default: the
  // existing char-count wrap (maxCaracteresPorLinea/maxLineas) is what the
  // general guion pipeline's presets already tune around, and this would
  // silently change their look. See Overlay.tsx's SubtitleLayer.
  lineaUnicaFluida: z.boolean().default(false),
  // Firma bajo la línea de subtítulos (p. ej. "@azestudiocontable"): se muestra junto a cada bloque. `acento` es el trozo
  // del texto que va en `colorAcento` (p. ej. "az" en dorado).
  marca: z
    .object({
      texto: z.string(),
      tamano: z.number().positive(),
      color: hexColorWithAlpha,
      colorAcento: hexColorWithAlpha,
      acento: z.string().default(""),
      margenSuperiorPx: z.number().default(8),
    })
    .optional(),
});

// One line's worth of styling for the "tresNiveles" título template (serif
// arriba / sans-serif bold en medio / sans-serif chica y con tracking abajo,
// p. ej. "Blanco Rosa" / "ROSA" / "PALO"). Each level gets its OWN font,
// unlike the rest of the preset (subtítulos + título "simple" share the
// single top-level `fuente`) — this is the first place in the preset that
// needs more than one typeface in the same composition.
const nivelTituloSchema = z.object({
  fuente: fuenteSchema,
  tamano: z.number().positive(),
  color: hexColorWithAlpha,
  trackingPx: z.number().default(0),
  mayusculas: z.boolean().default(false),
  // Multiplier on this level's own font size for the gap BETWEEN this
  // level's own wrapped lines (when its texto wraps to 2+ lines within the
  // width it's given) — 1.15 is the old hardcoded value, kept as the
  // default so no existing preset needs to change. Unrelated to
  // margenSuperiorPx, which only spaces this level from the one above it.
  interlineado: z.number().positive().default(1.15),
  // Pulls this level closer to the one above it (negative) or pushes it away
  // (positive) — a big font-size difference between levels (e.g. a 194px
  // nivel next to a 54px one) leaves a very pronounced gap from each font's
  // own line-height metrics alone, more than a uniform lineHeight number can
  // fix without risking clipped descenders on a script typeface.
  margenSuperiorPx: z.number().default(0),
  // Loose string, not z.enum(SUPPORTED_NIVEL_EFECTOS) — same "never reject a
  // preset for this, degrade with a warning at render time instead" rule as
  // animacionEntrada/animacionSalida above (see resolveNivelEfecto).
  efecto: z.string().default("ninguna"),
  // Optional per-level, not a single título-wide toggle: on a light/bright
  // take one nivel might need it and another (already on a dark card) might
  // not. Same shape as subtítulos' own `sombra` — titulo-cli.ts's --sombra
  // flag is what actually flips this on/off for all 3 at once without
  // editing the preset JSON.
  sombra: shadowSchema.optional(),
  // Escala `tamano` (y su tracking, proporcionalmente) hasta que la línea
  // ocupe EXACTAMENTE el ancho disponible (anchoMaximoFrac), en vez de
  // partirse en dos cuando no entra. Con esto `tamano` deja de ser el
  // tamaño final y pasa a ser solo la proporción de partida: el ancho del
  // cuadro manda. Es la única forma de tener el texto lo más grande
  // posible sin ir probando números a mano hasta dar con el que no corta.
  ajustarAlAncho: z.boolean().default(false),
  // Tope en px para el tamaño que `ajustarAlAncho` puede alcanzar: sin él,
  // una sola palabra corta ("Color") se agranda hasta ocupar todo el ancho
  // y se sale del cuadro. El ajuste sigue encogiendo lo que no entra; solo
  // deja de crecer pasado este número.
  tamanoMaximo: z.number().positive().optional(),
  // Al revés de ajustarAlAncho: NUNCA agranda, solo encoge `tamano` cuando
  // el texto (muchas palabras) no entra en el ancho disponible. Es lo que
  // evita que un nivel largo se salga de la pantalla sin volver gigante uno corto.
  reducirAlAncho: z.boolean().default(false),
  // Alineación de ESTA línea dentro del bloque de los 3 niveles (el ancho del bloque lo marca la línea más ancha,
  // normalmente la del medio): p. ej. superior "izquierda", medio grande, inferior "derecha".
  alineacion: z.enum(["izquierda", "centro", "derecha"]).default("centro"),
  // Empuja esta línea hacia el centro desde el borde al que la pega `alineacion`
  // ("izquierda" -> margen a la izquierda, "derecha" -> margen a la derecha).
  // Sin efecto con alineacion "centro".
  sangriaPx: z.number().default(0),
  // Nudge horizontal (px) de ESTA línea sola, sin importar `alineacion` —
  // positivo la mueve a la derecha, negativo a la izquierda. A diferencia
  // de `sangriaPx` (que solo actúa empujando desde el borde en izquierda/
  // derecha), este funciona igual con alineacion "centro", que es el caso
  // más común de querer correr una sola línea del bloque sin descentrar
  // las demás.
  desplazamientoXPx: z.number().default(0),
});

const tituloSchema = z
  .object({
    modo: z.enum(["superpuesto", "tarjeta"]).default("superpuesto"),
    duracionSeg: z.number().positive(),
    tamano: z.number().positive(),
    color: hexColorWithAlpha,
    fondo: backgroundSchema.optional(),
    posicion: z.enum(["inferior", "centro", "superior"]).default("centro"),
    // Fine vertical anchor as a fraction of frame height (0 = top edge, 1 =
    // bottom edge) — set only when `posicion`'s 3 fixed spots aren't precise
    // enough (e.g. "más abajo que el centro pero dejando espacio para los
    // subtítulos, que van independientes más abajo"). Overrides `posicion`
    // entirely when present; omitted keeps the exact old flex-based
    // behavior untouched, so no existing preset needs to change.
    posicionYFrac: z.number().min(0).max(1).optional(),
    // Horizontal nudge (px) for the WHOLE título block — only takes effect
    // together with posicionYFrac (that's what switches the block to the
    // absolute-positioned/translate(-50%,-50%) layout this rides on).
    // Positive moves it right, negative left; 0 (the default) keeps every
    // existing preset dead-centered exactly as before.
    bloqueDesplazamientoXPx: z.number().default(0),
    // How much of the frame's own width the título block (all 3 tresNiveles
    // lines together, or the single "simple" line) is allowed to use before
    // wrapping to a 2nd line — 0.86 is the old hardcoded value, kept as the
    // default so no existing preset needs to change. Raising it (closer to
    // 1) shrinks the safe side margins and buys room for a bigger tamano
    // before text wraps — titulo-cli.ts's --ancho-maximo is the quick way
    // to try that without editing the preset JSON.
    anchoMaximoFrac: z.number().min(0.1).max(1).default(0.86),
    margenSeguroPx: z.number().nonnegative().default(0),
    animacionEntrada: z.string().default("ninguna"),
    animacionSalida: z.string().default("ninguna"),
    entradaSeg: z.number().nonnegative().default(0),
    salidaSeg: z.number().nonnegative().default(0),
    // "simple" (default) es el título de una sola tipografía de siempre.
    // "tresNiveles" apila 3 líneas, cada una con su propia fuente/tamaño/
    // color — el TEXTO de cada línea sale de ScriptVideo.titulo dividido por
    // "|" (ver splitTresNivelesTexto en este archivo), acá solo se configura
    // el estilo de cada nivel.
    estilo: z.enum(SUPPORTED_TITLE_STYLES).default("simple"),
    tresNiveles: z.object({ superior: nivelTituloSchema, medio: nivelTituloSchema, inferior: nivelTituloSchema }).optional(),
  })
  .refine((t) => t.estilo !== "tresNiveles" || t.tresNiveles !== undefined, {
    message: 'titulo.estilo es "tresNiveles" pero falta titulo.tresNiveles (fuente/tamaño/color de cada nivel)',
    path: ["tresNiveles"],
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
  fuente: fuenteSchema,
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

export function resolveTitleAnimation(value: string): "fadeIn" | "fadeOut" | "wipeVertical" | "ninguna" {
  if (value === "fadeIn" || value === "fadeOut" || value === "wipeVertical" || value === "ninguna") return value;
  console.warn(
    `[video-editor] animación de título "${value}" no está soportada (soportadas: ${SUPPORTED_TITLE_ANIMATIONS.join(", ")}) — se usa "ninguna".`,
  );
  return "ninguna";
}

/**
 * "Blanco Rosa | ROSA | PALO" -> ["Blanco Rosa", "ROSA", "PALO"] — how a
 * "tresNiveles" título's 3 lines are packed into the script's single Título
 * field. Not a real newline: script-pdf.ts's TITLE_LINE regex only ever
 * captures ONE physical line (see its own comment), and PDF text extraction
 * has already been the direct cause of a real line-wrapping bug this repo
 * hit once — a "|" delimiter inside that one line is immune to both.
 * A missing part comes back as "" (never throws); TitleLayer skips an empty
 * level instead of rendering a blank line.
 */
export function splitTresNivelesTexto(texto: string): [string, string, string] {
  const [superior = "", medio = "", inferior = ""] = texto.split("|").map((part) => part.trim());
  return [superior, medio, inferior];
}

export function resolveNivelEfecto(value: string): (typeof SUPPORTED_NIVEL_EFECTOS)[number] {
  const found = SUPPORTED_NIVEL_EFECTOS.find((v) => v === value);
  if (found) return found;
  console.warn(
    `[video-editor] efecto de nivel "${value}" no está soportado (soportados: ${SUPPORTED_NIVEL_EFECTOS.join(", ")}) — se usa "ninguna".`,
  );
  return "ninguna";
}
