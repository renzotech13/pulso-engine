import { z } from "zod";

// Mirrors the parts of video-editor's Preset (src/pipeline/preset.ts) that
// the overlay actually needs to draw — kept as its own literal schema
// rather than a shared import, same reasoning as the old
// subtitle-overlay.schema.ts: render-video can't depend on video-editor
// (dependency points the other way), and the two are free to evolve at
// different rates.

const hexColor = z.string();
const outlineSchema = z.object({ color: hexColor, grosor: z.number() });
const shadowSchema = z.object({ color: hexColor, desplazamiento: z.number() });
const backgroundSchema = z.object({ activo: z.boolean(), color: hexColor, radio: z.number(), padding: z.number() });

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

const subtituloEstiloSchema = z.object({
  tamano: z.number(),
  color: hexColor,
  colorPalabraActiva: hexColor,
  contorno: outlineSchema.optional(),
  sombra: shadowSchema.optional(),
  fondo: backgroundSchema.optional(),
  posicion: z.enum(["inferior", "centro", "superior"]),
  margenSeguroInferiorPx: z.number(),
  maxCaracteresPorLinea: z.number(),
  maxLineas: z.number(),
  mayusculas: z.boolean(),
  resaltarPalabraActiva: z.boolean(),
  animacion: z.enum(["pop", "ninguna"]),
});

const tituloEstiloSchema = z.object({
  texto: z.string(),
  modo: z.enum(["superpuesto", "tarjeta"]),
  duracionSeg: z.number(),
  tamano: z.number(),
  color: hexColor,
  fondo: backgroundSchema.optional(),
  posicion: z.enum(["inferior", "centro", "superior"]),
  animacionEntrada: z.enum(["fadeIn", "ninguna"]),
  animacionSalida: z.enum(["fadeOut", "ninguna"]),
  entradaSeg: z.number(),
  salidaSeg: z.number(),
});

export const overlaySchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fuente: z.object({ familia: z.string(), archivo: z.string().optional(), peso: z.number() }),
  subtitulos: z.array(overlayBlockSchema),
  subtituloEstilo: subtituloEstiloSchema,
  /** Absent entirely when scriptVideo.mostrarTitulo is false — nothing to show, not "show an empty title". */
  titulo: tituloEstiloSchema.optional(),
});

export type OverlayProps = z.infer<typeof overlaySchema>;
