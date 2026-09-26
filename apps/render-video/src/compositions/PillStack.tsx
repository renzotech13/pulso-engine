// Standalone, self-contained composition for a 3-pill stacked callout —
// white "Cámbiate a Movistar" CTA pill (logo badge with the real Movistar M,
// rendered as a normal <img> INSIDE the badge circle so it inherits the same
// scale() the circle/pill already animates with — no more ffmpeg-compositing
// a static M on top afterward, which left the logo looking frozen while the
// pill bounced in around it), dark-blue "Internet ilimitado" pill, white
// price pill — each bouncing in staggered, same animation family as
// PrecioCard/PrecioCardPlan/FeatureCards. Deliberately NOT registered in the
// shared Root.tsx/registry.ts.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const pillStackSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  posicionYFrac: z.number().min(0).max(1),
  anchoMaximoFrac: z.number().min(0.1).max(1).default(0.9),
  separacionPx: z.number().default(18),
  colorAcento: z.string().default("#3EC6FF"),

  // Pill 1 — white CTA pill with a logo badge + chevron.
  colorCtaFondo: z.string().default("#FFFFFF"),
  colorCtaTexto: z.string().default("#0E1F4D"),
  textoCta: z.string().default("Cámbiate a Movistar"),
  /** file:// (or http) URL of the Movistar M logo — rendered as a real <img> inside the badge circle so it scales in with it. Omit to leave the circle empty (old ffmpeg-composited-afterward behavior). */
  logoMUrl: z.string().optional(),

  // Pill 2 — dark pill, wifi icon + 2-line label.
  colorWifiFondo: z.string().default("#0D5DA6"),
  colorWifiTexto: z.string().default("#FFFFFF"),
  colorWifiAcento: z.string().default("#3EC6FF"),
  textoWifiPrincipal: z.string().default("Internet"),
  textoWifiSecundario: z.string().default("ilimitado"),

  // Pill 3 — white price pill, "S/ 39.90" style with superscript cents.
  colorPrecioFondo: z.string().default("#FFFFFF"),
  colorPrecioTexto: z.string().default("#0E1F4D"),
  valorPrecio: z.string().default("S/ 39.90"),
  etiquetaPrecio: z.string().default("Solo otras líneas"),
});

export type PillStackProps = z.infer<typeof pillStackSchema>;

const PILL_STAGGER_FRAMES = 12;
const PILL_START = 0;

function usePillScale(index: number, fps: number): number {
  const frame = useCurrentFrame();
  return spring({
    frame: frame - (PILL_START + index * PILL_STAGGER_FRAMES),
    fps,
    config: { damping: 11, stiffness: 240, mass: 0.6 },
  });
}

/** Small rotated rounded bars peeking from a pill's corner — the "energy/motion" accent in the reference. */
function Chispas({ color, side }: { color: string; side: "left" | "right" }) {
  const rotate = side === "left" ? -20 : 20;
  return (
    <div style={{ position: "absolute", [side]: -14, top: "50%", transform: `translateY(-50%) rotate(${rotate}deg)`, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ width: 22, height: 7, borderRadius: 4, background: color }} />
      <div style={{ width: 14, height: 7, borderRadius: 4, background: color, marginLeft: side === "left" ? 0 : 8 }} />
    </div>
  );
}

function IconoChevron({ color, size }: { color: string; size: number }) {
  return (
    <svg viewBox="0 0 60 100" width={size * 0.6} height={size}>
      <path d="M12 8 L48 50 L12 92" fill="none" stroke={color} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconoWifi({ color, size }: { color: string; size: number }) {
  return (
    <svg viewBox="0 0 100 80" width={size} height={size * 0.8}>
      <path d="M10 34a56 56 0 0 1 80 0" fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
      <path d="M25 52a34 34 0 0 1 50 0" fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
      <path d="M40 70a13 13 0 0 1 20 0" fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
    </svg>
  );
}

export function PillStack(props: PillStackProps) {
  const {
    width,
    height,
    posicionYFrac,
    anchoMaximoFrac,
    separacionPx,
    colorAcento,
    colorCtaFondo,
    colorCtaTexto,
    textoCta,
    logoMUrl,
    colorWifiFondo,
    colorWifiTexto,
    colorWifiAcento,
    textoWifiPrincipal,
    textoWifiSecundario,
    colorPrecioFondo,
    colorPrecioTexto,
    valorPrecio,
    etiquetaPrecio,
  } = props;
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  const scaleCta = usePillScale(0, fps);
  const scaleWifi = usePillScale(1, fps);
  const scalePrecio = usePillScale(2, fps);
  const exitOpacity = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // "S/ 39.90" -> "S/" + "39" full-size + "·90" raised/small — same split as PrecioCard/PrecioCardPlan.
  const spaceIndex = valorPrecio.indexOf(" ");
  const simbolo = spaceIndex === -1 ? valorPrecio : valorPrecio.slice(0, spaceIndex);
  const numero = spaceIndex === -1 ? "" : valorPrecio.slice(spaceIndex + 1);
  const dotIndex = numero.indexOf(".");
  const numeroEntero = dotIndex === -1 ? numero : numero.slice(0, dotIndex);
  const numeroDecimal = dotIndex === -1 ? "" : numero.slice(dotIndex + 1);

  const precioTamano = 118;
  const blockWidth = width * anchoMaximoFrac;
  const fontFamily = "'Grift Black', system-ui, sans-serif";

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: height * posicionYFrac,
          transform: "translate(-50%, -50%)",
          width: blockWidth,
          opacity: exitOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: separacionPx,
          fontFamily,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: "fit-content", gap: separacionPx }}>
        {/* Pill 1 — CTA */}
        <div
          style={{
            position: "relative",
            transform: `scale(${scaleCta})`,
            width: "fit-content",
            boxSizing: "border-box",
            background: colorCtaFondo,
            borderRadius: 999,
            boxShadow: "0 10px 26px rgba(0,0,0,0.28)",
            padding: "16px 25px",
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          {/* Circle + text centered as their OWN group (gap 14, tight) in
              the space left of the chevron, instead of the circle anchored
              at the pill's edge with the text drifting off toward the
              pill's overall center — that read as the icon "left behind". */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            {/* Logo badge: the M scales in together with the circle (and the
                rest of the pill) since it's a real child here now, instead of
                a static PNG stamped on top afterward by ffmpeg. */}
            <div
              style={{
                width: 84,
                height: 84,
                minWidth: 84,
                borderRadius: "50%",
                border: `3px solid ${colorAcento}`,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {logoMUrl && <img src={logoMUrl} alt="" style={{ width: "62%", height: "62%", objectFit: "contain" }} />}
            </div>
            <div style={{ fontSize: 51, color: colorCtaTexto, whiteSpace: "nowrap" }}>{textoCta}</div>
          </div>
          <IconoChevron color={colorCtaTexto} size={60} />
        </div>

        {/* Pill 2 — Internet ilimitado */}
        <div
          style={{
            transform: `scale(${scaleWifi})`,
            width: "100%",
            boxSizing: "border-box",
            background: colorWifiFondo,
            borderRadius: 999,
            boxShadow: "0 10px 26px rgba(0,0,0,0.28)",
            padding: "26px 30px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div style={{ position: "relative", left: -20, lineHeight: 0 }}><IconoWifi color={colorWifiTexto} size={164} /></div>
          <div style={{ width: 2, alignSelf: "stretch", background: "rgba(255,255,255,0.4)" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.02 }}>
            <span style={{ fontSize: 58, color: colorWifiTexto, whiteSpace: "nowrap" }}>{textoWifiPrincipal}</span>
            <span style={{ fontSize: 76, color: colorWifiAcento, whiteSpace: "nowrap" }}>{textoWifiSecundario}</span>
          </div>
        </div>

        {/* Pill 3 — Price */}
        <div
          style={{
            position: "relative",
            alignSelf: "center",
            transform: `scale(${scalePrecio})`,
            width: "85%",
            boxSizing: "border-box",
            background: colorPrecioFondo,
            border: `5px solid ${colorAcento}`,
            borderRadius: 999,
            boxShadow: "0 10px 26px rgba(0,0,0,0.28)",
            padding: "20px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Chispas grandes FUERA del pill, en diagonal, apuntando al pill (> a la izquierda, < a la derecha) */}
          {([["left", 30], ["left", -30], ["right", -30], ["right", 30]] as const).map(([side, rot], k) => (
            <div
              key={k}
              style={{
                position: "absolute",
                [side]: -62,
                top: k % 2 === 0 ? "14%" : "62%",
                width: 41,
                height: 10,
                borderRadius: 8,
                background: colorAcento,
                transform: `rotate(${rot}deg)`,
              }}
            />
          ))}
          <div style={{ fontFamily: "'Grift Black', system-ui, sans-serif", fontSize: precioTamano, color: colorPrecioTexto, lineHeight: 1, whiteSpace: "nowrap" }}>
            {valorPrecio.replace(" ", "")}
          </div>
          <div
            style={{
              fontFamily: "'Grift', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 36,
              color: colorPrecioTexto,
              marginTop: -15,
              whiteSpace: "nowrap",
            }}
          >
            {etiquetaPrecio}
          </div>
        </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
