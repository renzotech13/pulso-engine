import type { BrandKitProps } from "./social-post";

export interface CarouselProps {
  brand: BrandKitProps;
  slides: string[];
  slideIndex: number;
  photoUrls?: Array<string | undefined>;
}

export const CAROUSEL_SIZE = { width: 1080, height: 1080 };

/**
 * Renders exactly ONE slide per page load (slideIndex picks which) — the
 * render route calls this once per slide and stitches the resulting images
 * into `creatives.asset_urls`. Each slide can carry its own photo (themed to
 * that slide's own text, resolved by the Creative agent) — same photo+overlay
 * treatment as SocialPostTemplate for whichever slides have one; the last
 * slide is always the comment-CTA and gets a visually distinct fallback
 * gradient so it stands out when someone swipes to the end and has no photo.
 */
export function CarouselTemplate({ brand, slides, slideIndex, photoUrls }: CarouselProps) {
  const isFirst = slideIndex === 0;
  const isLast = slideIndex === slides.length - 1;
  const text = slides[slideIndex] ?? "";
  const photoUrl = photoUrls?.[slideIndex];
  const usePhoto = Boolean(photoUrl);

  return (
    <div
      style={{
        width: CAROUSEL_SIZE.width,
        height: CAROUSEL_SIZE.height,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: usePhoto
          ? `linear-gradient(0deg, ${brand.colorPrimary}F2 0%, ${brand.colorPrimary}66 45%, ${brand.colorPrimary}33 100%), url(${photoUrl}) center/cover no-repeat`
          : isLast
            ? `radial-gradient(circle at 50% 35%, ${brand.colorSecondary} 0%, ${brand.colorPrimary} 70%)`
            : `radial-gradient(circle at 30% 20%, ${brand.colorSecondary} 0%, ${brand.colorPrimary} 65%)`,
      }}
    >
      {brand.logoUrl && (
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 40,
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
          color: brand.colorPrimary,
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
          padding: 120,
        }}
      >
        {isLast && (
          <div style={{ fontSize: 96, marginBottom: 24 }}>💬</div>
        )}
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
