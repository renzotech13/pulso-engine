// Shared shapes for every artifact the pipeline writes to disk. Each stage
// (2.1-2.8 in the spec) reads the previous stage's JSON and writes its own —
// never touches raw files it doesn't own — so any single stage can be
// re-run (e.g. re-render with a new preset) without repeating the ones
// before it. See project.ts for where these get written/read per project.

import { z } from "zod";

// --- 2.1 Ingesta ------------------------------------------------------------

export const assetProbeSchema = z.object({
  path: z.string(),
  /** Wall-clock seconds. */
  durationSec: z.number().positive(),
  videoCodec: z.string(),
  audioCodec: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  hasAudio: z.boolean(),
});
export type AssetProbe = z.infer<typeof assetProbeSchema>;

// --- 2.2 Guion ---------------------------------------------------------------

// A scene's visual requirement — "fondo" asks for a background-replace
// (background-replace.ts) behind the talking head, "apoyo" asks for a
// full-frame b-roll cutaway. `tipo` is a plain string, not an enum, on
// purpose: a typo or a not-yet-supported value in a hand-written script
// shouldn't fail parsing (same reasoning as animacion in preset.ts) — a
// future consumer decides what to do with a value it doesn't recognize.
// `referencia` is a tag/id looked up against a b-roll library (b-roll.ts),
// not necessarily an exact toma id.
export const requisitoVisualSchema = z.object({
  tipo: z.string().min(1),
  referencia: z.string().min(1),
});
export type RequisitoVisual = z.infer<typeof requisitoVisualSchema>;

export const escenaGuionSchema = z.object({
  numero: z.number().int().positive(),
  texto: z.string(),
  requisitos: z.array(requisitoVisualSchema).default([]),
});
export type EscenaGuion = z.infer<typeof escenaGuionSchema>;

export const scriptVideoSchema = z.object({
  id: z.string(),
  titulo: z.string().nullable(),
  mostrarTitulo: z.boolean(),
  guion: z.string(),
  /** Carpeta con las tomas crudas de este guion (de una línea "Carpeta: ..."). Null cuando el documento no la indica. */
  carpetaTomas: z.string().nullable().default(null),
  /**
   * Desglose explícito en escenas (de encabezados "Escena N: [...]") — vacío
   * cuando el guion no usa esa convención, en cuyo caso todo sigue
   * funcionando igual que antes a partir de `guion` solo.
   */
  escenas: z.array(escenaGuionSchema).default([]),
  /**
   * Set by the heading-based fallback parser when it isn't confident this
   * block was split correctly — never set by the LLM path, which either
   * produces a clean result or fails outright. Surfaced in the review
   * screen (Fase 3); Fase 1 just needs to carry the flag.
   */
  necesitaRevision: z.boolean().default(false),
});
export type ScriptVideo = z.infer<typeof scriptVideoSchema>;

export const scriptDocumentSchema = z.object({
  videos: z.array(scriptVideoSchema).min(1),
});
export type ScriptDocument = z.infer<typeof scriptDocumentSchema>;

// --- 2.3 Transcripción -------------------------------------------------------

export const transcriptWordSchema = z.object({
  text: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
});
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

export const silenceSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
});
export type Silence = z.infer<typeof silenceSchema>;

export const audioAnalysisSchema = z.object({
  assetPath: z.string(),
  provider: z.string(),
  language: z.string(),
  words: z.array(transcriptWordSchema),
  silences: z.array(silenceSchema),
});
export type AudioAnalysis = z.infer<typeof audioAnalysisSchema>;

// --- 2.4 EDL -----------------------------------------------------------------

export const edlSegmentSchema = z.object({
  archivo: z.string(),
  inicio: z.number().nonnegative(),
  fin: z.number().nonnegative(),
  /** What was actually SAID, per the transcript — kept for debugging/review even when guionTexto below is used for display. */
  lineaGuion: z.string(),
  /** Which script video this segment belongs to (scriptVideoSchema.id). */
  videoId: z.string(),
  /** The script's own (correctly spelled/accented) wording for this segment, when the match was confident enough to trust it — see buildEdl's guionTextConfidence. Undefined falls back to lineaGuion for subtitles. */
  guionTexto: z.string().optional(),
});
export type EdlSegment = z.infer<typeof edlSegmentSchema>;

export const edlSchema = z.object({
  videoId: z.string(),
  segmentos: z.array(edlSegmentSchema),
});
export type Edl = z.infer<typeof edlSchema>;

// --- 2.6 Subtítulos -----------------------------------------------------------

export const subtitleBlockSchema = z.object({
  /** Seconds along the EDL's OWN timeline (post-cut), not the source file's. */
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  text: z.string(),
  /** Per-word timing within this block, for karaoke highlighting (Fase 2). */
  words: z.array(transcriptWordSchema),
  bajaConfianza: z.boolean().default(false),
});
export type SubtitleBlock = z.infer<typeof subtitleBlockSchema>;

export const subtitleTrackSchema = z.object({
  videoId: z.string(),
  bloques: z.array(subtitleBlockSchema),
});
export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>;
