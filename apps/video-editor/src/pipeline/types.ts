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

export const scriptVideoSchema = z.object({
  id: z.string(),
  titulo: z.string().nullable(),
  mostrarTitulo: z.boolean(),
  guion: z.string(),
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
  lineaGuion: z.string(),
  /** Which script video this segment belongs to (scriptVideoSchema.id). */
  videoId: z.string(),
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
