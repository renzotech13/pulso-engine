import type { CarouselProps } from "./carousel";

export { CAROUSEL_SIZE as CAROUSEL_AZ_SIZE } from "./carousel";

/** Same "celeste fresh sky" as social-post-az.tsx — hardcoded, not
 * brand.colorPrimary (AZ's real brand accent, dorado arena #c19263, shared
 * with the social-post/reel/story templates and the brand-kit page). */
const AZ_SKY_BLUE = "#00A6ED";

/**
 * AZ Estudio Contable's own variant of CarouselTemplate: same per-slide
 * shape (one slide per page load, photo+gradient or a plain gradient
 * fallback for the last CTA slide), but the fixed sky blue above and a
 * 152px left margin shared by the logo and the text block — same two
 * changes as social-post-az.tsx, kept consistent across both of AZ's
 * templates rather than just the single-image post.
 */
export function CarouselTemplateAZ({ brand, slides, slideIndex, photoUrls }: CarouselProps) {
  const isFirst = slideIndex === 0;
  const isLast = slideIndex === slides.length - 1;
  const text = slides[slideIndex] ?? "";
  const photoUrl = photoUrls?.[slideIndex];
  const usePhoto = Boolean(photoUrl);

  return (
    <div
      style={{
        width: 1080,
        height: 1080,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: usePhoto
          ? // Quoted url(): unquoted breaks on a URL containing a space or
            // parentheses (a real filename shape — e.g. a duplicate
            // upload's "... (1).jpg" — confirmed live, not hypothetical).
            `linear-gradient(0deg, ${AZ_SKY_BLUE}F2 0%, ${AZ_SKY_BLUE}66 45%, ${AZ_SKY_BLUE}33 100%), url("${photoUrl}") center/cover no-repeat`
          : `radial-gradient(circle at 30% 20%, ${AZ_SKY_BLUE} 0%, ${AZ_SKY_BLUE} 65%)`,
      }}
    >
      {brand.logoUrl && (
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 152,
            width: 108,
            height: 108,
            borderRadius: "50%",
            background: "white",
            boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={brand.logoUrl}
            alt={brand.tenantName}
            style={{ maxWidth: 70, maxHeight: 58, objectFit: "contain" }}
          />
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 48,
          right: 48,
          background: "rgba(255,255,255,0.9)",
          color: AZ_SKY_BLUE,
          fontWeight: 700,
          fontSize: 24,
          padding: "8px 20px",
          borderRadius: 999,
        }}
      >
        {slideIndex + 1}/{slides.length}
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: isLast ? "center" : "flex-start",
          textAlign: isLast ? "center" : "left",
          paddingLeft: 152,
          paddingRight: 100,
          paddingTop: 120,
          paddingBottom: 120,
        }}
      >
        {isLast && <div style={{ fontSize: 96, marginBottom: 24 }}>💬</div>}
        <p
          style={{
            margin: 0,
            marginBottom: 12,
            fontSize: 20,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.85)",
            fontWeight: 600,
          }}
        >
          {isFirst ? brand.tenantName : isLast ? "Cuéntanos" : `Tip ${slideIndex}`}
        </p>
        <h1
          style={{
            margin: 0,
            fontSize: isFirst || isLast ? 58 : 48,
            lineHeight: 1.15,
            fontWeight: 800,
            color: "white",
            textShadow: "0 4px 24px rgba(0,0,0,0.35)",
          }}
        >
          {text}
        </h1>
      </div>
    </div>
  );
}
