// Standalone composition: green "ESCRÍBENOS / POR WHATSAPP" pill with the WhatsApp
// glyph poking out of its left edge and a glowing neon arrow that points at it.
// Same isolation rule as the other Movistar one-offs: NOT registered in the
// shared Root.tsx/registry.ts (see precio-card-root.tsx).
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const whatsappPillSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  texto1: z.string().default("ESCRÍBENOS"),
  texto2: z.string().default("POR WHATSAPP"),
  posicionYFrac: z.number().min(0).max(1).default(0.8),
  anchoPx: z.number().positive().default(760),
  alturaPx: z.number().positive().default(190),
  colorVerdeInicio: z.string().default("#46B24F"),
  colorVerdeFin: z.string().default("#1B7A2B"),
  colorTexto1: z.string().default("#FFFFFF"),
  colorTexto2: z.string().default("#C8F03A"),
  colorBrillo: z.string().default("#B6FF3C"),
  /** Segundos que tarda en aparecer la flecha después del pill. */
  retrasoFlechaSeg: z.number().nonnegative().default(0.6),
  /** Segundos por pulso de brillo (flecha + borde). */
  pulsoSeg: z.number().positive().default(1.1),
});

export type WhatsappPillProps = z.infer<typeof whatsappPillSchema>;

const WA_PATH =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z";

function useSpringScale(startFrame: number, fps: number, damping = 11): number {
  const frame = useCurrentFrame();
  return spring({ frame: frame - startFrame, fps, config: { damping, stiffness: 240, mass: 0.6 } });
}

export function WhatsappPill(props: WhatsappPillProps) {
  const { width, height, texto1, texto2, posicionYFrac, anchoPx, alturaPx, colorVerdeInicio, colorVerdeFin, colorTexto1, colorTexto2, colorBrillo, retrasoFlechaSeg, pulsoSeg } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const scalePill = useSpringScale(0, fps);
  const scaleIcono = useSpringScale(7, fps, 8);
  const scaleTexto = useSpringScale(11, fps);
  const arrowStart = Math.round(retrasoFlechaSeg * fps);
  const scaleFlecha = useSpringScale(arrowStart, fps, 9);
  const exitOpacity = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const pulso = 0.5 + 0.5 * Math.sin((frame / (pulsoSeg * fps)) * Math.PI * 2);
  const glowPx = 8 + pulso * 22;
  // La flecha "apunta": se acerca un poco al pill con cada pulso.
  const nudge = pulso * 14;

  const bumpR = alturaPx * 0.6;
  const bumpCx = alturaPx * 0.34;
  const bumpCy = alturaPx * 0.42;
  const icono = alturaPx * 0.86;
  const radio = alturaPx * 0.24;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: height * posicionYFrac,
          width: anchoPx,
          height: alturaPx,
          transform: `translate(-50%, -50%)`,
          opacity: exitOpacity,
          fontFamily: "'Grift Black', system-ui, sans-serif",
        }}
      >
        {/* Pill + protuberancia verde detrás del ícono (una sola silueta: rect redondeado ∪ círculo) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `scale(${scalePill})`,
            filter: `drop-shadow(0 0 ${glowPx}px ${colorBrillo}) drop-shadow(0 14px 18px rgba(0,0,0,0.35))`,
          }}
        >
          <svg width={anchoPx + 400} height={alturaPx + 400} viewBox={`-200 -200 ${anchoPx + 400} ${alturaPx + 400}`} style={{ position: "absolute", left: -200, top: -200, overflow: "visible" }}>
            <defs>
              <linearGradient id="verdeWa" gradientUnits="userSpaceOnUse" x1="0" y1={bumpCy - bumpR} x2="0" y2={alturaPx}>
                <stop offset="0%" stopColor={colorVerdeInicio} />
                <stop offset="100%" stopColor={colorVerdeFin} />
              </linearGradient>
            </defs>
            {/* contornos */}
            <rect x={0} y={0} width={anchoPx} height={alturaPx} rx={radio} fill="url(#verdeWa)" stroke={colorBrillo} strokeWidth={8} />
            <circle cx={bumpCx} cy={bumpCy} r={bumpR} fill="url(#verdeWa)" stroke={colorBrillo} strokeWidth={8} />
            {/* rellenos encima: tapan el borde interno donde se cruzan */}
            <rect x={4} y={4} width={anchoPx - 8} height={alturaPx - 8} rx={radio - 4} fill="url(#verdeWa)" />
            <circle cx={bumpCx} cy={bumpCy} r={bumpR - 4} fill="url(#verdeWa)" />
            <rect x={4} y={4} width={anchoPx - 8} height={alturaPx - 8} rx={radio - 4} fill="rgba(255,255,255,0.10)" clipPath="inset(0 0 55% 0)" />
          </svg>
        </div>
        {/* Icono de WhatsApp centrado en la protuberancia */}
        <div
          style={{
            position: "absolute",
            left: bumpCx - icono / 2,
            top: bumpCy - icono / 2,
            width: icono,
            height: icono,
            transform: `scale(${scaleIcono})`,
            filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.3))",
          }}
        >
          <svg viewBox="0 0 24 24" width={icono} height={icono}>
            <path d={WA_PATH} fill="#FFFFFF" />
          </svg>
        </div>
        {/* Textos */}
        <div
          style={{
            position: "absolute",
            left: bumpCx + bumpR * 0.95,
            right: 24,
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${scaleTexto})`,
            lineHeight: 1.0,
            textShadow: "0 3px 6px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ fontSize: alturaPx * 0.44, color: colorTexto1, whiteSpace: "nowrap", letterSpacing: 1 }}>{texto1}</div>
          <div style={{ fontSize: alturaPx * 0.27, color: colorTexto2, whiteSpace: "nowrap", marginTop: 4 }}>{texto2}</div>
        </div>
        {/* Flecha neón que apunta al pill */}
        <div
          style={{
            position: "absolute",
            right: -alturaPx * 0.985 + nudge * 0.5,
            top: "50%",
            marginTop: -alturaPx * 0.42 - nudge * 0.3 - 20,
            width: alturaPx * 0.9,
            height: alturaPx * 1.05,
            transform: `scale(${scaleFlecha})`,
            transformOrigin: "20% 80%",
            filter: `drop-shadow(0 0 ${glowPx}px ${colorBrillo}) drop-shadow(0 0 ${glowPx * 0.5}px ${colorBrillo})`,
          }}
        >
          <svg viewBox="0 0 90 105" width="100%" height="100%">
            {/* flecha curva hueca, punta abajo-izquierda */}
            <path
              d="M72 4 C86 52 66 80 36 78 L34 88 L4 68 L38 48 L38 60 C58 66 66 44 66 4 Z"
              fill="rgba(10,40,120,0.55)"
              stroke={colorBrillo}
              strokeWidth={5}
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </AbsoluteFill>
  );
}
