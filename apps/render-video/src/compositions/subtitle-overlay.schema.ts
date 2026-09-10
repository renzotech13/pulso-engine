import { z } from "zod";

// Mirrors video-editor's SubtitleBlock (apps/video-editor/src/pipeline/types.ts)
// but kept as its own literal schema — this package can't depend on
// video-editor (it's the other way around) without a circular workspace
// dependency, and the two evolve at different rates anyway (Fase 2 adds
// per-word karaoke fields here that the pipeline type doesn't need yet).
export const subtitleOverlayBlockSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  text: z.string(),
});

export const subtitleOverlaySchema = z.object({
  bloques: z.array(subtitleOverlayBlockSchema),
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type SubtitleOverlayProps = z.infer<typeof subtitleOverlaySchema>;
