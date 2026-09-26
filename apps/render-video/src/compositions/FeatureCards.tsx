// Standalone, self-contained composition for the one-off Movistar feature
// pills: a white rounded pill per benefit, each with a blue line-art icon in
// its own circle that OVERLAPS the pill's left edge (the circle is drawn on
// top, so its arc reads over the pill — that's the look of the reference).
// Same isolation rule as PrecioCard.tsx: deliberately NOT registered in the
// shared Root.tsx/registry.ts, so nothing here can reach AZ/Aura or any
// other tenant's renders.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const ICONOS = ["chip", "casa", "delivery", "cobertura"] as const;
type IconoKey = (typeof ICONOS)[number];

export const featureCardsSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  // One pill per item. `texto` splits on "|" into its own lines, same
  // convention the títulos use.
  items: z
    .array(
      z.object({
        icono: z.enum(ICONOS),
        texto: z.string(),
        // When set, this card's entrance starts at this exact point in the
        // composition's own timeline (e.g. the instant the voiceover says
        // that benefit) instead of the uniform CARD_STAGGER_FRAMES stagger —
        // lets each pill sync to the audio instead of firing on a fixed
        // rhythm. Omit to keep the old evenly-staggered behavior.
        inicioSec: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
  colorTarjeta: z.string(),
  colorTexto: z.string(),
  colorIcono: z.string(),
  /** Light ring around the icon circle, same family as colorIcono — omit for no border. */
  colorBordeIcono: z.string().optional(),
  /** When true, colorBordeIcono's ring becomes the same traveling two-comet conic-gradient light PrecioCardPlan's card border uses, instead of a static ring. */
  bordeIconoAnimado: z.boolean().default(false),
  /** Seconds per full lap around the icon circle's border — only used when bordeIconoAnimado is true. */
  bordeIconoVelocidadSeg: z.number().positive().default(3.2),
  /** Vertical center of the whole stack, as a fraction of frame height. */
  posicionYFrac: z.number().min(0).max(1),
  anchoMaximoFrac: z.number().min(0.1).max(1).default(0.86),
  tamanoTexto: z.number().positive().default(36),
  alturaTarjeta: z.number().positive().default(132),
  /** Diameter (px) of the icon circle. Omit to keep the original behavior (alturaTarjeta * 1.06) — set it to grow the pill taller (alturaTarjeta) without also growing the circle. */
  circuloPx: z.number().positive().optional(),
  /** Corner radius of the pill. Half of alturaTarjeta would make it fully circular at the ends; lower values square it off. */
  radioTarjeta: z.number().nonnegative().default(34),
  /** Fixed pill width (px) shared by every item — omit to let each pill hug its own text width instead. Ignored when `columnas` > 1 (each pill fills its grid cell instead). */
  anchoTarjetaPx: z.number().positive().optional(),
  /** Padding (px) between the end of the text and the pill's right edge — 46 was the original hardcoded value, kept as the default so no existing render needs to change. */
  paddingDerechoPx: z.number().nonnegative().default(46),
  /** Vertical gap between rows (and, in single-column mode, between every card). */
  separacionPx: z.number().default(22),
  /** 1 = the original stacked single column. 2 = a 2-column grid (2 items per row) — the layout the reference asked for, cards in 2 rows above the price card. */
  columnas: z.number().int().min(1).max(2).default(1),
  /** Horizontal gap between the 2 columns — only used when columnas is 2. */
  separacionColPx: z.number().default(20),
  /** How much narrower than its grid cell each pill is (px) — only used when columnas is 2, leaves a visible margin on the pill's right edge instead of it filling the whole cell. */
  margenDerechoGridPx: z.number().nonnegative().default(0),
  /** Extra padding (px) above/below the text, on top of the height alturaTarjeta already sets — grows the pill taller without touching its width. */
  paddingVerticalPx: z.number().nonnegative().default(0),
  /** Nudges ONLY the first row's items up (px) — a pure visual transform, doesn't touch row-gap/grid sizing, so row 2 and everything positioned relative to this block (e.g. the price card below) stays exactly where it was. Only used when columnas is 2. */
  desplazamientoFilaSuperiorPx: z.number().default(0),
  /** Horizontal nudge (px) for the whole block — 0 (the default) keeps it centered exactly as before; negative moves it left, positive right. Same idea as Overlay.tsx's título bloqueDesplazamientoXPx. */
  bloqueDesplazamientoXPx: z.number().default(0),
});

export type FeatureCardsProps = z.infer<typeof featureCardsSchema>;

// Each card plays its own 3-beat entrance — pill fades/slides in, THEN the
// circle pops, THEN the icon scales up inside it — before the next card
// starts, per "cada card sale uno por uno" (one at a time, not all at once).
const CARD_START = 0;
const CARD_STAGGER_FRAMES = 17;
const PILL_OFFSET = 0;
const PILL_DURATION = 9;
const CIRCLE_OFFSET = 6;
const ICON_OFFSET = 12;

function Icono({ nombre, color, size }: { nombre: IconoKey; color: string; size: number }) {
  const trazo = {
    fill: "none" as const,
    stroke: color,
    strokeWidth: 7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (nombre === "chip") {
    return (
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <path d="M30 14h26l16 16v56a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8Z" {...trazo} />
        <rect x="36" y="48" width="28" height="26" rx="7" {...trazo} />
      </svg>
    );
  }
  if (nombre === "casa") {
    return (
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <path d="M14 50 50 18l36 32" {...trazo} />
        <path d="M25 45v33a7 7 0 0 0 7 7h36a7 7 0 0 0 7-7V45" {...trazo} />
        <path d="M41 85V63h18v22" {...trazo} />
      </svg>
    );
  }
  if (nombre === "delivery") {
    return (
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <path d="M34 32h28a4 4 0 0 1 4 4v30H34a4 4 0 0 1-4-4V36a4 4 0 0 1 4-4Z" {...trazo} />
        <path d="M66 44h9l11 13v9h-20V44Z" {...trazo} />
        <circle cx="46" cy="73" r="7" {...trazo} />
        <circle cx="75" cy="73" r="7" {...trazo} />
        <path d="M6 38h16M2 52h20M8 66h14" {...trazo} />
      </svg>
    );
  }
  // "cobertura": a map pin, same single-<svg>-root shape as every other
  // icon here — a previous bars+"4G/5G" label version (nested div, see git
  // history) rendered as a blank circle in practice, so this stays a plain
  // stroked glyph like its siblings instead of reintroducing that layout.
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <path d="M50 10c-16.6 0-30 13.4-30 30 0 22.5 30 50 30 50s30-27.5 30-50c0-16.6-13.4-30-30-30Z" {...trazo} />
      <circle cx="50" cy="40" r="11" {...trazo} />
    </svg>
  );
}

export function FeatureCards(props: FeatureCardsProps) {
  const {
    width,
    height,
    items,
    colorTarjeta,
    colorTexto,
    colorIcono,
    colorBordeIcono,
    bordeIconoAnimado,
    bordeIconoVelocidadSeg,
    posicionYFrac,
    anchoMaximoFrac,
    tamanoTexto,
    alturaTarjeta,
    circuloPx,
    radioTarjeta,
    anchoTarjetaPx,
    separacionPx,
    columnas,
    separacionColPx,
    margenDerechoGridPx,
    paddingVerticalPx,
    paddingDerechoPx,
    desplazamientoFilaSuperiorPx,
    bloqueDesplazamientoXPx,
  } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Same tail fade as the price card — a bouncy entrance that then vanishes
  // on a hard frame boundary reads as a glitch, not a cut.
  const exitOpacity = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // alturaTarjeta is now the pill's real, fixed, final height (see the
  // `height` — not minHeight — on the pill below), so the circle just
  // tracks it directly.
  const circulo = circuloPx ?? alturaTarjeta * 1.06;
  const anchoBloque = width * anchoMaximoFrac;
  // The pill starts at the circle's horizontal center, so the circle sticks
  // out to the left by exactly its own radius — the overlap in the reference.
  const solape = circulo / 2;

  // Same traveling two-comet conic-gradient border light as
  // PrecioCardPlan.tsx's card edge, just wrapped around a circle (borderRadius
  // 50%) instead of a rounded rect — see that file for the geometry notes.
  const bordeIconoGrosorPx = 3;
  const bordeIconoVelocidadFrames = bordeIconoVelocidadSeg * fps;
  const bordeIconoAngulo = 315 + (frame / bordeIconoVelocidadFrames) * 360;
  const bordeIconoTramo = interpolate(frame, [0, durationInFrames], [10, 180], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bordeIconoGradient = colorBordeIcono
    ? `conic-gradient(from ${bordeIconoAngulo}deg, ` +
      `${colorBordeIcono} 0deg, transparent ${bordeIconoTramo}deg, transparent ${180 - bordeIconoTramo}deg, ` +
      `${colorBordeIcono} 180deg, transparent ${180 + bordeIconoTramo}deg, transparent ${360 - bordeIconoTramo}deg, ` +
      `${colorBordeIcono} 360deg)`
    : undefined;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: (width - anchoBloque) / 2 + bloqueDesplazamientoXPx,
          top: height * posicionYFrac,
          transform: "translateY(-50%)",
          width: anchoBloque,
          opacity: exitOpacity,
          display: columnas === 2 ? "grid" : "flex",
          flexDirection: columnas === 2 ? undefined : "column",
          gridTemplateColumns: columnas === 2 ? "1fr 1fr" : undefined,
          columnGap: columnas === 2 ? separacionColPx : undefined,
          rowGap: columnas === 2 ? separacionPx : undefined,
          gap: columnas === 2 ? undefined : separacionPx,
          fontFamily: "'Grift Medium', system-ui, sans-serif",
        }}
      >
        {items.map((item, i) => {
          const base = item.inicioSec !== undefined ? Math.round(item.inicioSec * fps) : CARD_START + i * CARD_STAGGER_FRAMES;

          // 1) Pill: fade in while sliding left-to-right.
          const pillT = interpolate(frame - (base + PILL_OFFSET), [0, PILL_DURATION], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const pillOpacity = pillT;
          const pillTranslateX = interpolate(pillT, [0, 1], [-70, 0]);

          // 2) Circle: pops up after the pill has (mostly) arrived.
          const circleScale = spring({
            frame: frame - (base + CIRCLE_OFFSET),
            fps,
            config: { damping: 11, stiffness: 260, mass: 0.6 },
          });

          // 3) Icon: scales 0->100 with a soft bounce settling at the end,
          // once the circle is in place.
          const iconScale = spring({
            frame: frame - (base + ICON_OFFSET),
            fps,
            config: { damping: 9, stiffness: 170, mass: 0.6 },
          });
          const lineas = item.texto.split("|").map((l) => l.trim()).filter(Boolean);
          const esFilaSuperior = columnas === 2 && i < columnas;
          const filaOffsetY = esFilaSuperior ? desplazamientoFilaSuperiorPx : 0;

          return (
            <div
              key={item.texto}
              style={{
                display: "flex",
                alignItems: "center",
                transform: `translate(${pillTranslateX}px, ${filaOffsetY}px)`,
                opacity: pillOpacity,
              }}
            >
              <div
                style={{
                  width: circulo,
                  height: circulo,
                  minWidth: circulo,
                  borderRadius: "50%",
                  background: bordeIconoAnimado ? bordeIconoGradient : colorTarjeta,
                  border: !bordeIconoAnimado && colorBordeIcono ? `3px solid ${colorBordeIcono}` : undefined,
                  padding: bordeIconoAnimado ? bordeIconoGrosorPx : undefined,
                  boxSizing: "border-box",
                  boxShadow: "0 6px 18px rgba(10,40,90,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: `scale(${circleScale})`,
                  // Above the pill so the circle's own edge draws over it.
                  zIndex: 2,
                }}
              >
                {bordeIconoAnimado ? (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      background: colorTarjeta,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div style={{ transform: `scale(${iconScale})` }}>
                      <Icono nombre={item.icono} color={colorIcono} size={circulo * 0.56} />
                    </div>
                  </div>
                ) : (
                  <div style={{ transform: `scale(${iconScale})` }}>
                    <Icono nombre={item.icono} color={colorIcono} size={circulo * 0.56} />
                  </div>
                )}
              </div>
              <div
                style={{
                  // In grid mode (2 columns) the pill fills its own cell —
                  // the cell width already IS the right size, unlike the
                  // single-column case where a % width would stretch across
                  // the whole block. Otherwise: content width, or the fixed
                  // anchoTarjetaPx when the caller wants every pill the same
                  // width without going to a full grid.
                  width: columnas === 2 ? `calc(100% - ${margenDerechoGridPx}px)` : anchoTarjetaPx,
                  minWidth: 0,
                  marginLeft: -solape,
                  paddingLeft: solape + 34,
                  paddingRight: paddingDerechoPx,
                  paddingTop: paddingVerticalPx,
                  paddingBottom: paddingVerticalPx,
                  // Fixed height, not minHeight — otherwise a 3-line card
                  // (e.g. "Recibe tu / chip gratis / en casa") grows taller
                  // than a 2-line one next to it. Fixed + vertically
                  // centered content means every card matches regardless of
                  // how many lines its own text happens to need.
                  height: alturaTarjeta,
                  boxSizing: "border-box",
                  borderRadius: radioTarjeta,
                  background: colorTarjeta,
                  boxShadow: "0 6px 18px rgba(10,40,90,0.15)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  color: colorTexto,
                  fontSize: tamanoTexto,
                  lineHeight: 0.98,
                  zIndex: 1,
                  whiteSpace: "nowrap",
                }}
              >
                {lineas.map((linea) => (
                  <div key={linea}>{linea}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
