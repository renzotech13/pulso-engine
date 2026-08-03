import { z } from "zod";
import { brandSchema } from "./brand-schema";

// Same split as reel.schema.ts — kept free of any "remotion" import.
export const storyPromoSchema = z.object({
  brand: brandSchema,
  message: z.string(),
  photoUrl: z.string().optional(),
});

export type StoryPromoProps = z.infer<typeof storyPromoSchema>;

export const STORY_PROMO_SIZE = { width: 1080, height: 1920 };
export const STORY_PROMO_FPS = 30;
export const STORY_PROMO_DURATION_FRAMES = 90;
