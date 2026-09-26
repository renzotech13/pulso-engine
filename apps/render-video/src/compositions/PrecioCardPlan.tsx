// Standalone, self-contained composition for a second Movistar price-badge
// layout — same card shape/animation family as PrecioCard.tsx (bg pops in,
// then each piece bounces in), but the right column is an icon + 2-line
// label ("∞ / INTERNET ILIMITADO") instead of a big number + small label.
// Kept as its OWN file rather than a PrecioCard prop, per explicit request
// to add variety for future videos without touching the existing approved
// PrecioCard. Deliberately NOT registered in the shared Root.tsx/registry.ts
// — same isolation rule as every other one-off Movistar composition here.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const ICONOS_DERECHA = ["infinito"] as const;
type IconoDerechaKey = (typeof ICONOS_DERECHA)[number];

export const precioCardPlanSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  // Left column: a short label above a big value (e.g. "Plan desde" / "S/ 39.90").
  etiquetaIzquierda: z.string(),
  valorIzquierda: z.string(),
  // Right column: an icon above a (usually 2-line, "|"-separated) label — e.g. "infinito" / "INTERNET | ILIMITADO".
  iconoDerecha: z.enum(ICONOS_DERECHA).default("infinito"),
  textoDerecha: z.string(),
  colorFondoInicio: z.string(),
  colorFondoFin: z.string(),
  colorTexto: z.string(),
  // Traveling light-border effect: two glows, starting at the top-left and
  // bottom-right corners (180° apart), sweep clockwise around the card's own
  // edge and grow as they go until together they light up the whole border.
  colorBorde: z.string().default("#FFFFFF"),
  bordeGrosorPx: z.number().nonnegative().default(4),
  /** Seconds per full lap around the border. */
  bordeVelocidadSeg: z.number().positive().default(3.2),
  // Fraction of frame height for the card's own vertical center (0 = top, 1 = bottom).
  posicionYFrac: z.number().min(0).max(1),
  anchoMaximoFrac: z.number().min(0.1).max(1).default(0.9),
});

export type PrecioCardPlanProps = z.infer<typeof precioCardPlanSchema>;

// Frame offsets (matches PrecioCard.tsx's own timing so the two feel like
// the same family if a caller ever swaps one for the other mid-project).
const BG_POP_START = 0;
const TEXT_STAGGER_FRAMES = 5;
const TEXT_START = 10;

function useBounceScale(startFrame: number, fps: number): number {
  const frame = useCurrentFrame();
  return spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 10, stiffness: 260, mass: 0.6 },
  });
}

/** The same bounce spring played backward, zeroing out at `zeroFrame` — pass
 * `durationInFrames - entranceStartFrame` for each element so the exit is a
 * literal mirror of the entrance: whatever popped in LAST leaves FIRST, and
 * the background (which popped in first) is the last thing to shrink away,
 * finishing exactly at the clip's own end like the background started
 * exactly at its own frame 0. */
function useExitBounceScale(zeroFrame: number, fps: number): number {
  const frame = useCurrentFrame();
  return spring({
    frame: zeroFrame - frame,
    fps,
    config: { damping: 10, stiffness: 260, mass: 0.6 },
  });
}

function IconoInfinito({ color, size }: { color: string; size: number }) {
  // A chunky lemniscate (∞) drawn as a thick stroked path rather than the
  // thin default glyph — matches the bold, filled-in look of the reference.
  return (
    // Two circles, tangent at the exact center point (their radii add up to
    // the distance between centers) — a plain "sideways 8" rather than a
    // hand-drawn lemniscate, which is what actually reads cleanly at small
    // sizes instead of the lumpy bezier attempt this replaced.
    <svg viewBox="0 0 100 50" width={size} height={size * 0.5}>
      <circle cx={32} cy={25} r={18} fill="none" stroke={color} strokeWidth={11} />
      <circle cx={68} cy={25} r={18} fill="none" stroke={color} strokeWidth={11} />
    </svg>
  );
}

export function PrecioCardPlan(props: PrecioCardPlanProps) {
  const { width, height, etiquetaIzquierda, valorIzquierda, iconoDerecha, textoDerecha, colorFondoInicio, colorFondoFin, colorTexto, colorBorde, bordeGrosorPx, bordeVelocidadSeg, posicionYFrac, anchoMaximoFrac } =
    props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // "S/ 39.90" -> symbol ("S/") sized separately from the amount ("39.90").
  const spaceIndex = valorIzquierda.indexOf(" ");
  const simboloIzquierda = spaceIndex === -1 ? valorIzquierda : valorIzquierda.slice(0, spaceIndex);
  const numeroIzquierda = spaceIndex === -1 ? "" : valorIzquierda.slice(spaceIndex + 1);

  // "39.90" -> "39" full-size + "·90" raised/small, same treatment as PrecioCard.
  const dotIndex = numeroIzquierda.indexOf(".");
  const numeroEntero = dotIndex === -1 ? numeroIzquierda : numeroIzquierda.slice(0, dotIndex);
  const numeroDecimal = dotIndex === -1 ? "" : numeroIzquierda.slice(dotIndex + 1);

  const lineasDerecha = textoDerecha.split("|").map((l) => l.trim()).filter(Boolean);

  const bgScale = spring({
    frame: frame - BG_POP_START,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.7 },
  });
  const bgOpacity = interpolate(frame - BG_POP_START, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Exit is the entrance played backward: the background — first thing IN —
  // is the last thing OUT, finishing exactly at durationInFrames the way it
  // started exactly at frame 0. Each text piece mirrors its own entrance
  // offset from that same end point, so the LAST piece to pop in (textoDerecha)
  // is the FIRST to shrink away, same stagger rhythm, reverse order.
  const bgExitScale = useExitBounceScale(durationInFrames, fps);
  const bgExitOpacity = interpolate(durationInFrames - frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const scales = {
    etiquetaIzquierda: useBounceScale(TEXT_START, fps) * useExitBounceScale(durationInFrames - TEXT_START, fps),
    valorIzquierda: useBounceScale(TEXT_START + TEXT_STAGGER_FRAMES, fps) * useExitBounceScale(durationInFrames - (TEXT_START + TEXT_STAGGER_FRAMES), fps),
    iconoDerecha: useBounceScale(TEXT_START + TEXT_STAGGER_FRAMES * 2, fps) * useExitBounceScale(durationInFrames - (TEXT_START + TEXT_STAGGER_FRAMES * 2), fps),
    textoDerecha: useBounceScale(TEXT_START + TEXT_STAGGER_FRAMES * 3, fps) * useExitBounceScale(durationInFrames - (TEXT_START + TEXT_STAGGER_FRAMES * 3), fps),
  };

  const cardWidth = width * anchoMaximoFrac;

  // Border-light sweep: two glows 180° apart, starting near the top-left and
  // bottom-right corners, rotating clockwise together. `tramo` (the glow's
  // half-width in degrees) grows from a tight comet-point to 180° over the
  // clip's own duration, so by the end the two glows have expanded to meet
  // and the whole ring reads as lit — not just two dots chasing forever.
  const bordeVelocidadFrames = bordeVelocidadSeg * fps;
  const angulo = 315 + (frame / bordeVelocidadFrames) * 360;
  const tramo = interpolate(frame, [0, durationInFrames], [10, 180], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // One conic-gradient, two bright points 180° apart in its own stop list
  // (at 0deg and 180deg) — both ride the same rotating `from ${angulo}` together.
  const bordeGradient =
    `conic-gradient(from ${angulo}deg, ` +
    `${colorBorde} 0deg, transparent ${tramo}deg, transparent ${180 - tramo}deg, ` +
    `${colorBorde} 180deg, transparent ${180 + tramo}deg, transparent ${360 - tramo}deg, ` +
    `${colorBorde} 360deg)`;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: height * posicionYFrac,
          transform: `translate(-50%, -50%) scale(${bgScale * bgExitScale})`,
          opacity: bgOpacity * bgExitOpacity,
          width: "max-content",
          maxWidth: cardWidth,
          boxSizing: "border-box",
          borderRadius: 40,
          background: bordeGradient,
          padding: bordeGrosorPx,
        }}
      >
      <div
        style={{
          borderRadius: 40 - bordeGrosorPx,
          background: `linear-gradient(135deg, ${colorFondoInicio}, ${colorFondoFin})`,
          boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
          padding: "18px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Grift Black', system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", transformOrigin: "left center" }}>
          <div
            style={{
              // alignSelf centers this label over "S/ 39.90" below it
              // instead of sharing its left edge — the label reads narrower
              // than the value, so flex-start (like PrecioCard.tsx uses)
              // left it looking stuck to the left instead of centered.
              alignSelf: "center",
              transform: `scale(${scales.etiquetaIzquierda}) translateY(20px)`,
              fontFamily: "'Grift Light', system-ui, sans-serif",
              fontSize: 42,
              color: colorTexto,
              opacity: 0.92,
              marginTop: 10,
              whiteSpace: "nowrap",
              textTransform: "uppercase",
            }}
          >
            {etiquetaIzquierda}
          </div>
          <div
            style={{
              transform: `scale(${scales.valorIzquierda})`,
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              lineHeight: 1,
              marginTop: 4,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontSize: 113, color: colorTexto }}>{simboloIzquierda}</span>
            <span style={{ fontSize: 128, color: colorTexto, display: "inline-block", transform: "scale(1, 1.016)", transformOrigin: "left bottom" }}>
              {numeroEntero}
              {numeroDecimal && (
                <>
                  <span style={{ fontSize: 128 * 0.5, verticalAlign: "super", position: "relative", top: 18 }}>·</span>
                  <span style={{ fontSize: 128 * 0.5, verticalAlign: "super" }}>{numeroDecimal}</span>
                </>
              )}
            </span>
          </div>
        </div>

        <div style={{ width: 2, alignSelf: "stretch", background: "rgba(255,255,255,0.4)", margin: "0 20px" }} />

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transformOrigin: "center center" }}>
          <div style={{ transform: `scale(${scales.iconoDerecha})`, lineHeight: 0, marginBottom: 6 }}>
            {iconoDerecha === "infinito" && <IconoInfinito color={colorTexto} size={72} />}
          </div>
          <div
            style={{
              transform: `scale(${scales.textoDerecha})`,
              fontFamily: "'Grift Black', system-ui, sans-serif",
              fontSize: 44,
              color: colorTexto,
              lineHeight: 1.05,
              whiteSpace: "nowrap",
              textAlign: "center",
              textTransform: "uppercase",
            }}
          >
            {lineasDerecha.map((linea) => (
              <div key={linea}>{linea}</div>
            ))}
          </div>
        </div>
      </div>
      </div>
    </AbsoluteFill>
  );
}
