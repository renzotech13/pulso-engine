// Standalone, self-contained composition for a one-off Movistar price badge
// (green rounded card, 2 columns split by a divider, bg pops in softly then
// each text bounces in 0->100% scale). Deliberately NOT registered in the
// shared Root.tsx/registry.ts — those feed the multi-tenant product and
// every other brand's títulos/CTAs; this lives entirely off to the side
// (see precio-card-entry.ts/precio-card-root.tsx) so nothing here can affect
// AZ/Aura or any other tenant's render.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const precioCardSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  // Left column: a short label above a big value (e.g. "A solo" / "S/ 39.90").
  etiquetaIzquierda: z.string(),
  valorIzquierda: z.string(),
  // Right column: a big value above a short label (e.g. "225 GB" / "en alta velocidad").
  valorDerecha: z.string(),
  etiquetaDerecha: z.string(),
  colorFondoInicio: z.string(),
  colorFondoFin: z.string(),
  colorTexto: z.string(),
  colorAcento: z.string(),
  // Fraction of frame height for the card's own vertical center (0 = top, 1 = bottom) — the reference is a lower-third badge, so this defaults near the bottom from the caller.
  posicionYFrac: z.number().min(0).max(1),
  anchoMaximoFrac: z.number().min(0.1).max(1).default(0.9),
});

export type PrecioCardProps = z.infer<typeof precioCardSchema>;

export const PRECIO_CARD_FPS = 30;

// Frame offsets (at PRECIO_CARD_FPS) for the staged entrance: background
// pops in alone first, then the 4 text pieces bounce in one after another —
// matches "el fondo verde con un pop up suave ANTES de los textos" +
// "cada texto con un rebote corto al salir de 0 a 100 en escala".
const BG_POP_START = 0;
const TEXT_STAGGER_FRAMES = 5;
const TEXT_START = 10; // background is most of the way through its own pop by here

function useBounceScale(startFrame: number, fps: number): number {
  const frame = useCurrentFrame();
  // Short, snappy overshoot — high stiffness + low-ish damping settles in
  // under half a second instead of a long wobble, per "un rebote corto".
  return spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 10, stiffness: 260, mass: 0.6 },
  });
}

export function PrecioCard(props: PrecioCardProps) {
  const { width, height, etiquetaIzquierda, valorIzquierda, valorDerecha, etiquetaDerecha, colorFondoInicio, colorFondoFin, colorTexto, colorAcento, posicionYFrac, anchoMaximoFrac } =
    props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // "S/ 39.90" -> symbol ("S/") sized separately from the amount ("39.90") —
  // splits on the first space, which is all the one real value this card
  // ever holds needs.
  const spaceIndex = valorIzquierda.indexOf(" ");
  const simboloIzquierda = spaceIndex === -1 ? valorIzquierda : valorIzquierda.slice(0, spaceIndex);
  const numeroIzquierda = spaceIndex === -1 ? "" : valorIzquierda.slice(spaceIndex + 1);

  // "39.90" -> "39" full-size + "·90" raised/small, like a price tag's cents —
  // splits on the decimal point, which is all this card's amount ever has.
  const dotIndex = numeroIzquierda.indexOf(".");
  const numeroEntero = dotIndex === -1 ? numeroIzquierda : numeroIzquierda.slice(0, dotIndex);
  const numeroDecimal = dotIndex === -1 ? "" : numeroIzquierda.slice(dotIndex + 1);

  const bgScale = spring({
    frame: frame - BG_POP_START,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.7 },
  });
  const bgOpacity = interpolate(frame - BG_POP_START, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // Not asked for explicitly, but a hard last-frame cutoff after a bouncy
  // entrance reads as broken rather than intentional — a short fade covers
  // whatever exact instant the caller trims the composite at.
  const exitOpacity = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const scales = {
    etiquetaIzquierda: useBounceScale(TEXT_START, fps),
    valorIzquierda: useBounceScale(TEXT_START + TEXT_STAGGER_FRAMES, fps),
    valorDerecha: useBounceScale(TEXT_START + TEXT_STAGGER_FRAMES * 2, fps),
    etiquetaDerecha: useBounceScale(TEXT_START + TEXT_STAGGER_FRAMES * 3, fps),
  };

  const cardWidth = width * anchoMaximoFrac;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: height * posicionYFrac,
          // Shrink-wraps to its content (up to maxWidth) instead of a fixed
          // width — a fixed width was fine at the old, smaller price size,
          // but forcing "S/ 39.90"/"225 GB" into a column narrower than
          // their own text at the bigger size just wrapped them mid-value.
          transform: `translate(-50%, -50%) scale(${bgScale})`,
          opacity: bgOpacity * exitOpacity,
          width: "max-content",
          maxWidth: cardWidth,
          borderRadius: 40,
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
              // translateY, not marginTop — a margin change here grows the
              // column's own layout height, which grows the auto-sized card
              // AND drags "S/ 39.90" down with it. translateY moves only
              // this element's pixels, so nothing else shifts.
              transform: `scale(${scales.etiquetaIzquierda}) translateY(20px)`,
              fontFamily: "'Grift Light', system-ui, sans-serif",
              fontSize: 42,
              color: colorTexto,
              opacity: 0.92,
              marginTop: 10,
              whiteSpace: "nowrap",
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
            {/* "S/" and the amount are sized/shaped independently on request:
                the symbol 15pt smaller, the amount full-width (no more
                horizontal condensing — that read as too narrow) with just a
                couple points of extra height via a non-uniform transform. */}
            <span style={{ fontSize: 113, color: colorTexto }}>{simboloIzquierda}</span>
            <span style={{ fontSize: 128, color: colorTexto, display: "inline-block", transform: "scale(1, 1.016)", transformOrigin: "left bottom" }}>
              {numeroEntero}
              {numeroDecimal && (
                <>
                  {/* The dot sits lower than the "90" on purpose — level with
                      where the entero digits start (their cap-height top),
                      not floating up at the raised superscript height. */}
                  <span style={{ fontSize: 128 * 0.5, verticalAlign: "super", position: "relative", top: 18 }}>·</span>
                  <span style={{ fontSize: 128 * 0.5, verticalAlign: "super" }}>{numeroDecimal}</span>
                </>
              )}
            </span>
          </div>
        </div>

        <div style={{ width: 2, alignSelf: "stretch", background: "rgba(255,255,255,0.4)", margin: "0 20px" }} />

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", transformOrigin: "left center" }}>
          <div
            style={{
              transform: `scale(${scales.valorDerecha})`,
              fontSize: 128,
              color: colorAcento,
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {valorDerecha}
          </div>
          <div
            style={{
              transform: `scale(${scales.etiquetaDerecha}) translateX(50px)`,
              fontFamily: "'Grift Light', system-ui, sans-serif",
              fontSize: 41,
              color: colorTexto,
              opacity: 0.92,
              marginTop: -20,
              whiteSpace: "nowrap",
            }}
          >
            {etiquetaDerecha}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
