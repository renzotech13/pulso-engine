export interface StudentShowcaseBrand {
  logoUrl: string | null;
  tenantName: string;
}

export type StudentShowcaseSlideType = "photos" | "certificate" | "portrait";

export interface StudentShowcaseSlideData {
  type: StudentShowcaseSlideType;
  photoUrls: string[];
}

export interface StudentShowcaseProps {
  brand: StudentShowcaseBrand;
  eventName: string;
  eventYear: string;
  studentName: string;
  countryCode?: string;
  slide: StudentShowcaseSlideData;
}

export const STUDENT_SHOWCASE_SIZE = { width: 1080, height: 1350 };

/**
 * Bespoke to Escuela de Joyería Tejida's own Figma design — hardcoded colors
 * and the "De Magally Juro" subtitle are fine here specifically because this
 * component is wired to exactly one tenant's render_templates row, unlike
 * carousel.tsx/social-post.tsx which every tenant shares. Colors are a
 * by-eye approximation from the exported PNGs, not measured — revisit once
 * the Figma MCP is available to pull exact hex values.
 */
const GOLD = "#C4915A";
const OLIVE = "#3E3D22";
const CREAM = "#FBF7F0";

function flagEmoji(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return "";
  return countryCode
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

/**
 * Splits "Diana Gonzales" into ("Diana", "Gonzales") — the design puts the
 * first name (flanked by the flag) on its own line and everything after on
 * a second line, which reads fine for a two-word name and degrades
 * gracefully (just a longer second line) for a compound one.
 */
function splitName(fullName: string): [string, string] {
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return [trimmed, ""];
  return [trimmed.slice(0, spaceIndex), trimmed.slice(spaceIndex + 1)];
}

function NameBadge({
  nameLine1,
  nameLine2,
  flag,
  overlap,
}: {
  nameLine1: string;
  nameLine2: string;
  flag: string;
  /** Pulls the badge up under the photo card above it so it reads as one layered shape instead of two stacked boxes. */
  overlap: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 0,
        marginTop: overlap ? -56 : 24,
        paddingTop: overlap ? 80 : 24,
        paddingBottom: 28,
        paddingInline: 32,
        background: OLIVE,
        borderRadius: "28px 28px 160px 160px",
        textAlign: "center",
        color: "white",
      }}
    >
      <div style={{ fontSize: 34, fontFamily: "Georgia, 'Times New Roman', serif" }}>
        {flag} {nameLine1} {flag}
      </div>
      {nameLine2 && (
        <div style={{ fontSize: 34, fontFamily: "Georgia, 'Times New Roman', serif", marginTop: 2 }}>
          {nameLine2}
        </div>
      )}
    </div>
  );
}

export function StudentShowcaseTemplate({
  brand,
  eventName,
  eventYear,
  studentName,
  countryCode,
  slide,
}: StudentShowcaseProps) {
  const flag = flagEmoji(countryCode);
  const [nameLine1, nameLine2] = splitName(studentName);

  return (
    <div
      style={{
        width: STUDENT_SHOWCASE_SIZE.width,
        height: STUDENT_SHOWCASE_SIZE.height,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: CREAM,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ flexShrink: 0, background: GOLD, color: "white", padding: "56px 64px 44px" }}>
        <div
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontStyle: "italic",
            fontSize: 60,
            lineHeight: 1.05,
          }}
        >
          {eventName}
        </div>
        <div style={{ fontSize: 26, letterSpacing: 3, fontWeight: 600, marginTop: 10 }}>{eventYear}</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "48px 64px 0" }}>
        {slide.type === "portrait" ? (
          <div
            style={{
              alignSelf: "center",
              width: "72%",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: 400,
              boxShadow: "0 12px 32px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                flex: 1,
                background: `url(${slide.photoUrls[0] ?? ""}) center/cover no-repeat`,
              }}
            />
            <NameBadge nameLine1={nameLine1} nameLine2={nameLine2} flag={flag} overlap={false} />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div
              style={{
                position: "relative",
                zIndex: 1,
                background: "white",
                borderRadius: 32,
                padding: 20,
                display: "flex",
                gap: 16,
                boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
              }}
            >
              {slide.photoUrls.map((url, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    aspectRatio: slide.type === "certificate" ? "3 / 4" : "1 / 1",
                    borderRadius: 20,
                    background: `url(${url}) center/cover no-repeat`,
                  }}
                />
              ))}
            </div>
            <NameBadge nameLine1={nameLine1} nameLine2={nameLine2} flag={flag} overlap />
          </div>
        )}

        <div
          style={{
            marginTop: 32,
            paddingBottom: 24,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          {brand.logoUrl ? (
            <div
              style={{
                width: 92,
                height: 92,
                borderRadius: "50%",
                overflow: "hidden",
                border: "3px solid white",
                boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                background: `url(${brand.logoUrl}) center/cover no-repeat`,
              }}
            />
          ) : (
            <div />
          )}
          <div style={{ textAlign: "right", color: OLIVE, fontFamily: "Georgia, 'Times New Roman', serif" }}>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15 }}>{brand.tenantName}</div>
            <div style={{ fontSize: 16 }}>De Magally Juro</div>
          </div>
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          background: OLIVE,
          color: "white",
          textAlign: "center",
          fontSize: 21,
          lineHeight: 1.5,
          padding: "22px 48px",
        }}
      >
        Ceremonia de certificación como especialista en
        <br />
        Joyería Tejida en Punto Peruano TTPP
      </div>
    </div>
  );
}
