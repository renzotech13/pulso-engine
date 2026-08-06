import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReelProps } from "./reel.schema";

export { reelSchema, REEL_SIZE, REEL_FPS, REEL_DURATION_FRAMES, type ReelProps } from "./reel.schema";

/**
 * Same brief fields as SocialPostTemplate (Vía A), animated: headline
 * slides/fades in, price badge pops in ~20 frames later, subheadline
 * trails last. Fixed 1080x1920 — matches the composition's registered size.
 */
export function Reel({ brand, headline, subheadline, priceLabel, photoUrl }: ReelProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headlineSpring = spring({ frame, fps, config: { damping: 200 } });
  const headlineTranslateY = interpolate(headlineSpring, [0, 1], [60, 0]);
  const headlineOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });

  const badgeSpring = spring({ frame: frame - 20, fps, config: { damping: 12, stiffness: 200 } });
  const badgeScale = interpolate(badgeSpring, [0, 1], [0, 1]);

  const subheadlineOpacity = interpolate(frame, [35, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: photoUrl
          ? undefined
          : `radial-gradient(circle at 30% 20%, ${brand.colorSecondary} 0%, ${brand.colorPrimary} 65%)`,
      }}
    >
      {/* Plain CSS background: url() doesn't participate in Remotion's
          asset-loading barrier (unlike <Img>), so frames could get captured
          before the photo finished downloading — rendering as just the
          gradient with no photo. <Img> here fixes that the same way
          StoryPromo.tsx already does it. */}
      {photoUrl && (
        <AbsoluteFill>
          <Img src={photoUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      )}
      {photoUrl && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(0deg, ${brand.colorPrimary}F2 0%, ${brand.colorPrimary}66 45%, ${brand.colorPrimary}33 100%)`,
          }}
        />
      )}

      {brand.logoUrl && (
        <Img
          src={brand.logoUrl}
          style={{
            position: "absolute",
            top: 72,
            left: 56,
            height: 72,
            filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.35))",
          }}
        />
      )}

      {priceLabel && (
        <div
          style={{
            position: "absolute",
            top: 72,
            right: 56,
            transform: `scale(${badgeScale})`,
            background: "white",
            color: brand.colorPrimary,
            fontWeight: 700,
            fontSize: 34,
            padding: "12px 28px",
            borderRadius: 999,
          }}
        >
          {priceLabel}
        </div>
      )}

      <div style={{ padding: 64, paddingBottom: 160 }}>
        <p
          style={{
            margin: 0,
            marginBottom: 16,
            fontSize: 26,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.85)",
            fontWeight: 600,
            opacity: headlineOpacity,
          }}
        >
          {brand.tenantName}
        </p>
        <h1
          style={{
            margin: 0,
            fontSize: 84,
            lineHeight: 1.05,
            fontWeight: 800,
            color: "white",
            textShadow: "0 4px 24px rgba(0,0,0,0.35)",
            opacity: headlineOpacity,
            transform: `translateY(${headlineTranslateY}px)`,
          }}
        >
          {headline}
        </h1>
        {subheadline && (
          <p
            style={{
              marginTop: 24,
              marginBottom: 0,
              fontSize: 36,
              color: "rgba(255,255,255,0.92)",
              fontWeight: 500,
              opacity: subheadlineOpacity,
            }}
          >
            {subheadline}
          </p>
        )}
      </div>
    </AbsoluteFill>
  );
}
