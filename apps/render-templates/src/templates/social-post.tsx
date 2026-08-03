export interface BrandKitProps {
  logoUrl: string | null;
  colorPrimary: string;
  colorSecondary: string;
  tenantName: string;
}

export interface SocialPostProps {
  brand: BrandKitProps;
  headline: string;
  subheadline?: string;
  priceLabel?: string;
  photoUrl?: string;
}

export const SOCIAL_POST_SIZE = { width: 1080, height: 1080 };

/**
 * First real template of Vía A. Fixed pixel size on purpose — this gets
 * screenshotted at exactly SOCIAL_POST_SIZE by Puppeteer, so anything that
 * reflows past that boundary would just get cropped.
 */
export function SocialPostTemplate({ brand, headline, subheadline, priceLabel, photoUrl }: SocialPostProps) {
  return (
    <div
      style={{
        width: SOCIAL_POST_SIZE.width,
        height: SOCIAL_POST_SIZE.height,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: photoUrl
          ? `linear-gradient(0deg, ${brand.colorPrimary}F2 0%, ${brand.colorPrimary}66 45%, ${brand.colorPrimary}33 100%), url(${photoUrl}) center/cover no-repeat`
          : `radial-gradient(circle at 30% 20%, ${brand.colorSecondary} 0%, ${brand.colorPrimary} 65%)`,
      }}
    >
      {brand.logoUrl && (
        <>
          {/* Accent circle peeking out from behind the badge — softens the
              hard-edged photo/gradient rectangle behind it. */}
          <div
            style={{
              position: "absolute",
              top: 66,
              left: 118,
              width: 84,
              height: 84,
              borderRadius: "50%",
              background: brand.colorSecondary,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 40,
              left: 40,
              width: 148,
              height: 148,
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
              style={{ maxWidth: 96, maxHeight: 80, objectFit: "contain" }}
            />
          </div>
        </>
      )}

      {priceLabel && (
        <div
          style={{
            position: "absolute",
            top: 48,
            right: 48,
            background: "white",
            color: brand.colorPrimary,
            fontWeight: 700,
            fontSize: 28,
            padding: "10px 24px",
            borderRadius: 999,
          }}
        >
          {priceLabel}
        </div>
      )}

      <div style={{ padding: 56, paddingTop: 120 }}>
        <p
          style={{
            margin: 0,
            marginBottom: 12,
            fontSize: 22,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.85)",
            fontWeight: 600,
          }}
        >
          {brand.tenantName}
        </p>
        <h1
          style={{
            margin: 0,
            fontSize: 72,
            lineHeight: 1.05,
            fontWeight: 800,
            color: "white",
            textShadow: "0 4px 24px rgba(0,0,0,0.35)",
          }}
        >
          {headline}
        </h1>
        {subheadline && (
          <p
            style={{
              marginTop: 20,
              marginBottom: 0,
              fontSize: 32,
              color: "rgba(255,255,255,0.92)",
              fontWeight: 500,
            }}
          >
            {subheadline}
          </p>
        )}
      </div>
    </div>
  );
}
