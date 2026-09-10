import type { SocialPostProps } from "./social-post";

export { SOCIAL_POST_SIZE as SOCIAL_POST_AZ_SIZE } from "./social-post";

/** "Celeste fresh sky" — AZ's own post color, hardcoded rather than read off
 * brand.colorPrimary: that field is AZ's actual brand accent (dorado arena,
 * #c19263 — see brand_kits), shared with carousel/reel/story templates and
 * the brand-kit dashboard page. This blue is deliberately just a "post"
 * treatment for this one tenant, not a brand-wide color change. */
const AZ_SKY_BLUE = "#00A6ED";

/**
 * AZ Estudio Contable's own variant of SocialPostTemplate (Vía A): same
 * shape (photo + gradient, logo, eyebrow/headline/subheadline), three
 * differences — the fixed sky-blue gradient above, a 152px left margin
 * shared by the logo and the text block (both sat at a plain 40/120 before),
 * and the text block pulled up off the very bottom edge so Instagram's feed
 * crop has more room before it reaches the headline.
 */
export function SocialPostTemplateAZ({ brand, headline, subheadline, priceLabel, photoUrl }: SocialPostProps) {
  return (
    <div
      style={{
        width: 1080,
        height: 1080,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: photoUrl
          ? `linear-gradient(0deg, ${AZ_SKY_BLUE}F2 0%, ${AZ_SKY_BLUE}66 45%, ${AZ_SKY_BLUE}33 100%), url(${photoUrl}) center/cover no-repeat`
          : `radial-gradient(circle at 30% 20%, ${AZ_SKY_BLUE} 0%, ${AZ_SKY_BLUE} 65%)`,
      }}
    >
      {brand.logoUrl && (
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 152,
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
      )}

      {priceLabel && (
        <div
          style={{
            position: "absolute",
            top: 48,
            right: 48,
            background: "white",
            color: AZ_SKY_BLUE,
            fontWeight: 700,
            fontSize: 28,
            padding: "10px 24px",
            borderRadius: 999,
          }}
        >
          {priceLabel}
        </div>
      )}

      <div style={{ paddingLeft: 152, paddingRight: 100, paddingBottom: 200 }}>
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
            fontSize: 58,
            lineHeight: 1.1,
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
              fontSize: 28,
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
