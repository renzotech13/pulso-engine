import { REEL_DURATION_FRAMES, REEL_FPS, REEL_SIZE, reelSchema } from "./compositions/reel.schema.js";
import {
  STORY_PROMO_DURATION_FRAMES,
  STORY_PROMO_FPS,
  STORY_PROMO_SIZE,
  storyPromoSchema,
} from "./compositions/story-promo.schema.js";
import { overlaySchema } from "./compositions/overlay.schema.js";

// Maps render_templates.component_ref to the Zod schema the creative's brief
// must satisfy plus the fixed output geometry — mirrors
// render-templates/src/templates/registry.ts for the HTML/Puppeteer side.
// Sourced from the *.schema.ts files (not the .tsx components) so this stays
// free of any "remotion" import — Next.js route handlers import this
// directly and can't load remotion's hooks (see index.ts).
export const REMOTION_REGISTRY = {
  reel: { schema: reelSchema, size: REEL_SIZE, fps: REEL_FPS, durationInFrames: REEL_DURATION_FRAMES },
  "story-promo": {
    schema: storyPromoSchema,
    size: STORY_PROMO_SIZE,
    fps: STORY_PROMO_FPS,
    durationInFrames: STORY_PROMO_DURATION_FRAMES,
  },
  // Size/fps/duration aren't fixed like the two above — they come from the
  // props at render time via calculateMetadata (Root.tsx), since this has
  // to exactly match whatever video-editor project it belongs to. The
  // values here are just a placeholder default for the Studio preview;
  // nothing reads them for a real render (selectComposition in render.ts
  // resolves the true metadata from calculateMetadata instead).
  overlay: {
    schema: overlaySchema,
    size: { width: 1080, height: 1920 },
    fps: 30,
    durationInFrames: 150,
  },
} as const;

export type RemotionCompositionRef = keyof typeof REMOTION_REGISTRY;

export function isKnownRemotionRef(ref: string): ref is RemotionCompositionRef {
  return ref in REMOTION_REGISTRY;
}
