import { z } from "zod";

// Mirrors the parts of video-editor's Preset (src/pipeline/preset.ts) that
// the overlay actually needs to draw — kept as its own literal schema
// rather than a shared import, same reasoning as the old
// subtitle-overlay.schema.ts: render-video can't depend on video-editor
// (dependency points the other way), and the two are free to evolve at
// different rates.

const hexColor = z.string();
const outlineSchema = z.object({ color: hexColor, grosor: z.number() });
/** Optional `grosorPx` — see video-editor's shadowSchema. */
const shadowSchema = z.object({ color: hexColor, desplazamiento: z.number(), blur: z.number().optional(), halo: z.boolean().optional(), grosorPx: z.number().optional() });
const backgroundSchema = z.object({ activo: z.boolean(), color: hexColor, radio: z.number(), padding: z.number() });
const fuenteSchema = z.object({ familia: z.string(), archivo: z.string().optional(), peso: z.number() });

export const overlayWordSchema = z.object({
  text: z.string(),
  startSec: z.number(),
  endSec: z.number(),
});

export const overlayBlockSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  words: z.array(overlayWordSchema),
});

// Same "karaoke pill" shape as video-editor's preset.ts — see there for why
// it carries its own colorTexto instead of reusing colorPalabraActiva.
const fondoPalabraActivaSchema = z.object({
  activo: z.boolean(),
  color: hexColor,
  colorTexto: hexColor,
  radio: z.number(),
  paddingX: z.number(),
  paddingY: z.number(),
});

const subtituloEstiloSchema = z.object({
  tamano: z.number(),
  color: hexColor,
  colorPalabraActiva: hexColor,
  contorno: outlineSchema.optional(),
  sombra: shadowSchema.optional(),
  fondo: backgroundSchema.optional(),
  /** Overrides the composition's top-level `fuente` for subtitles only — absent falls back to it. */
  fuente: fuenteSchema.optional(),
  fondoPalabraActiva: fondoPalabraActivaSchema.optional(),
  posicion: z.enum(["inferior", "centro", "superior"]),
  margenSeguroInferiorPx: z.number(),
  maxCaracteresPorLinea: z.number(),
  maxLineas: z.number(),
  mayusculas: z.boolean(),
  resaltarPalabraActiva: z.boolean(),
  animacion: z.enum(["pop", "ninguna"]),
  lineaUnicaFluida: z.boolean(),
  /** Firma bajo la línea de subtítulos — see video-editor's subtitulosSchema.marca. */
  marca: z
    .object({ texto: z.string(), tamano: z.number(), color: hexColor, colorAcento: hexColor, acento: z.string(), margenSuperiorPx: z.number() })
    .optional(),
});

// One line of the "tresNiveles" template (see video-editor's preset.ts) —
// its own font/size/color/tracking, independent of the título's own
// `color`/`tamano` (those only apply in "simple" mode).
const nivelTituloEstiloSchema = z.object({
  texto: z.string(),
  fuente: fuenteSchema,
  tamano: z.number(),
  color: hexColor,
  trackingPx: z.number(),
  mayusculas: z.boolean(),
  /** Line-height multiplier for the gap between this level's own wrapped lines — see video-editor's nivelTituloSchema.interlineado. */
  interlineado: z.number(),
  margenSuperiorPx: z.number(),
  // Takes over from the título's shared animacionEntrada/animacionSalida for
  // THIS level when not "ninguna" — see Overlay.tsx's TitleLayer.
  efecto: z.enum(["ninguna", "mascaraVertical", "letrasOla", "letrasJuntan"]),
  sombra: shadowSchema.optional(),
  /** Scale this level's font (and tracking) so the line exactly fills the available width instead of wrapping — see video-editor's nivelTituloSchema.ajustarAlAncho. */
  ajustarAlAncho: z.boolean(),
  /** Cap (px) on how large `ajustarAlAncho` may grow this level — see video-editor's nivelTituloSchema.tamanoMaximo. */
  tamanoMaximo: z.number().optional(),
  /** Shrink-only fit: never enlarges, only scales down when the line doesn't fit — see nivelTituloSchema.reducirAlAncho. */
  reducirAlAncho: z.boolean(),
  /** Alignment of this line inside the 3-level block — see video-editor's nivelTituloSchema.alineacion. */
  alineacion: z.enum(["izquierda", "centro", "derecha"]).default("centro"),
  /** Pushes this line toward the center from the edge `alineacion` pins it to — see video-editor's nivelTituloSchema.sangriaPx. */
  sangriaPx: z.number().default(0),
  /** Horizontal nudge (px) for this line alone, independent of `alineacion` — see video-editor's nivelTituloSchema.desplazamientoXPx. */
  desplazamientoXPx: z.number(),
});

const tituloEstiloSchema = z.object({
  texto: z.string(),
  modo: z.enum(["superpuesto", "tarjeta"]),
  duracionSeg: z.number(),
  tamano: z.number(),
  color: hexColor,
  fondo: backgroundSchema.optional(),
  posicion: z.enum(["inferior", "centro", "superior"]),
  /** Fraction of frame height (0=top, 1=bottom) — overrides `posicion` entirely when set. */
  posicionYFrac: z.number().optional(),
  /** Horizontal nudge (px) for the whole título block — see video-editor's tituloSchema.bloqueDesplazamientoXPx. */
  bloqueDesplazamientoXPx: z.number(),
  /** Fraction of frame width the whole título block may use before wrapping — see video-editor's tituloSchema.anchoMaximoFrac. */
  anchoMaximoFrac: z.number(),
  /** Padding kept clear of whichever edge `posicion` sits against — 0 (the old implicit behavior) when the preset doesn't set it. */
  margenSeguroPx: z.number(),
  // "wipeVertical" is valid on both fields — see video-editor's
  // SUPPORTED_TITLE_ANIMATIONS comment for why it's the one animation shared
  // by both directions.
  animacionEntrada: z.enum(["fadeIn", "wipeVertical", "ninguna"]),
  animacionSalida: z.enum(["fadeOut", "wipeVertical", "ninguna"]),
  entradaSeg: z.number(),
  salidaSeg: z.number(),
  estilo: z.enum(["simple", "tresNiveles"]),
  /** Set exactly when estilo is "tresNiveles" — video-editor's tituloSchema refine guarantees the two travel together. */
  tresNiveles: z.object({ superior: nivelTituloEstiloSchema, medio: nivelTituloEstiloSchema, inferior: nivelTituloEstiloSchema }).optional(),
});

export const overlaySchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fuente: fuenteSchema,
  subtitulos: z.array(overlayBlockSchema),
  subtituloEstilo: subtituloEstiloSchema,
  /** Absent entirely when scriptVideo.mostrarTitulo is false — nothing to show, not "show an empty title". */
  titulo: tituloEstiloSchema.optional(),
});

export type OverlayProps = z.infer<typeof overlaySchema>;
