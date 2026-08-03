import { Composition } from "remotion";
import { Reel, REEL_DURATION_FRAMES, REEL_FPS, REEL_SIZE, reelSchema } from "./compositions/Reel";
import {
  STORY_PROMO_DURATION_FRAMES,
  STORY_PROMO_FPS,
  STORY_PROMO_SIZE,
  StoryPromo,
  storyPromoSchema,
} from "./compositions/StoryPromo";

const DEFAULT_BRAND = {
  logoUrl: null,
  colorPrimary: "#7C6FF0",
  colorSecondary: "#FF8B5E",
  tenantName: "Demo",
};

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="reel"
        component={Reel}
        durationInFrames={REEL_DURATION_FRAMES}
        fps={REEL_FPS}
        width={REEL_SIZE.width}
        height={REEL_SIZE.height}
        schema={reelSchema}
        defaultProps={{ brand: DEFAULT_BRAND, headline: "20% en masajes" }}
      />
      <Composition
        id="story-promo"
        component={StoryPromo}
        durationInFrames={STORY_PROMO_DURATION_FRAMES}
        fps={STORY_PROMO_FPS}
        width={STORY_PROMO_SIZE.width}
        height={STORY_PROMO_SIZE.height}
        schema={storyPromoSchema}
        defaultProps={{ brand: DEFAULT_BRAND, message: "20% en masajes" }}
      />
    </>
  );
}
