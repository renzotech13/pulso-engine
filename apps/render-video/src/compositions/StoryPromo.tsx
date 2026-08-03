import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { StoryPromoProps } from "./story-promo.schema";

export {
  storyPromoSchema,
  STORY_PROMO_SIZE,
  STORY_PROMO_FPS,
  STORY_PROMO_DURATION_FRAMES,
  type StoryPromoProps,
} from "./story-promo.schema";

/**
 * Simpler than Reel on purpose — one message, slow ken-burns zoom on the
 * photo if there is one, solid brand color if not. Meant for the "story"
 * calendar slots, which are single-beat, not a multi-element promo.
 */
export function StoryPromo({ brand, message, photoUrl }: StoryPromoProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const scale = interpolate(frame, [0, durationInFrames], [1, 1.15]);
  const messageOpacity = interpolate(frame, [10, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: brand.colorPrimary, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {photoUrl && (
        <AbsoluteFill style={{ transform: `scale(${scale})` }}>
          <Img src={photoUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      )}
      <AbsoluteFill
        style={{
          background: photoUrl
            ? "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%)"
            : undefined,
          justifyContent: "flex-end",
          padding: 72,
        }}
      >
        <p
          style={{
            margin: 0,
            opacity: messageOpacity,
            color: "white",
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.2,
            textShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}
        >
          {message}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
