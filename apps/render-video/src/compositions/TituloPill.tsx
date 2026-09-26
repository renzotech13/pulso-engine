// Standalone composition: two-line "title pill" — a stepped blue rounded shape
// (line 1 box shorter than line 2 box, both left-aligned and fused), white
// bold line 1 + turquoise bigger line 2, two neon-cyan sparks outside the right
// edge. Each line box bounces in (spring) one after the other. New file on
// purpose: reuses the spring/bounce pattern of PillStack/FeatureCards without
// touching any of them. NOT registered in the shared Root.tsx/registry.ts.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const tituloPillSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  texto1: z.string().default("¿Eres Bitel y quieres"),
  texto2: z.string().default("internet ilimitado?"),
  posicionYFrac: z.number().min(0).max(1).default(0.3),
  /** Desplazamiento horizontal del bloque (px) desde el centro. */
  desplazamientoXPx: z.number().default(0),
  colorFondo: z.string().default("#2050B9"),
  colorTexto1: z.string().default("#FFFFFF"),
  colorTexto2: z.string().default("#4FE3D6"),
  colorChispas: z.string().default("#4FE3D6"),
  tamano1: z.number().positive().default(64),
  tamano2: z.number().positive().default(84),
  /** Posición vertical (% del alto de la línea 2) de la chispa de arriba y la de abajo. */
  chispaArribaPct: z.number().default(34),
  chispaAbajoPct: z.number().default(56),
});

export type TituloPillProps = z.infer<typeof tituloPillSchema>;

function useBounce(startFrame: number, fps: number): number {
  const frame = useCurrentFrame();
  return spring({ frame: frame - startFrame, fps, config: { damping: 9, stiffness: 260, mass: 0.6 } });
}

export function TituloPill(props: TituloPillProps) {
  const { height, texto1, texto2, posicionYFrac, desplazamientoXPx, colorFondo, colorTexto1, colorTexto2, colorChispas, tamano1, tamano2, chispaArribaPct, chispaAbajoPct } = props;
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const s1 = useBounce(0, fps);
  const s2 = useBounce(6, fps);
  const sChispas = useBounce(14, fps);
  const exitOpacity = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pulso = 0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 2 * 1.4);
  const fuente = "'Grift Black', system-ui, sans-serif";
  const caja = { background: colorFondo, whiteSpace: "nowrap" as const, fontFamily: fuente, lineHeight: 1 };

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: "50%", top: height * posicionYFrac, transform: `translate(calc(-50% + ${desplazamientoXPx}px), -50%)`, opacity: exitOpacity }}>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div style={{ ...caja, color: colorTexto1, fontSize: tamano1, padding: `${tamano1 * 0.32}px ${tamano1 * 0.5}px ${tamano1 * 0.22}px`, borderRadius: `${tamano1 * 0.7}px ${tamano1 * 0.7}px ${tamano1 * 0.7}px 0`, transform: `scale(${s1})`, transformOrigin: "left bottom", position: "relative", zIndex: 1 }}>
            {texto1}
          </div>
          <div style={{ ...caja, color: colorTexto2, fontSize: tamano2, padding: `${tamano2 * 0.22}px ${tamano2 * 0.55}px ${tamano2 * 0.3}px ${tamano2 * 0.4}px`, borderRadius: `0 ${tamano2 * 0.6}px ${tamano2 * 0.6}px ${tamano2 * 0.6}px`, marginTop: -1, transform: `scale(${s2})`, transformOrigin: "left top", position: "relative" }}>
            {texto2}
            {/* chispas a caballo del borde derecho (mitad dentro / mitad fuera), invertidas: < */}
            {([-28, 28] as const).map((rot, k) => (
              <div key={k} style={{ position: "absolute", right: -tamano2 * 0.25, top: `${k === 0 ? chispaArribaPct : chispaAbajoPct}%`, width: tamano2 * 0.5, height: tamano2 * 0.12, borderRadius: 8, background: colorChispas, transform: `rotate(${rot}deg) scale(${sChispas})`, boxShadow: `0 0 ${6 + pulso * 14}px ${colorChispas}` }} />
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
