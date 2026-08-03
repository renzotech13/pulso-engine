import { z } from "zod";
import { brandSchema } from "./brand-schema";

// Split from Reel.tsx on purpose: this file must stay free of any "remotion"
// import. Next.js route handlers (React Server Components condition) can't
// load remotion's hooks — they use React context, which isn't available in
// that condition — but they do need this schema to validate a brief before
// handing off to the render subprocess.
export const reelSchema = z.object({
  brand: brandSchema,
  headline: z.string(),
  subheadline: z.string().optional(),
  priceLabel: z.string().optional(),
  photoUrl: z.string().optional(),
});

export type ReelProps = z.infer<typeof reelSchema>;

export const REEL_SIZE = { width: 1080, height: 1920 };
export const REEL_FPS = 30;
export const REEL_DURATION_FRAMES = 120;
