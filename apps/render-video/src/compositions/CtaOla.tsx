// Standalone composition: Movistar CTA = 2-line wave title (every letter enters
// with a bounce, then keeps a slow sea-wave, same mechanics/values as TituloOlas)
// ALWAYS followed by the blinking down-arrow (ArrowDown, reused untouched with
// the movistar-flecha-abajo props). New file; nothing existing is
// modified. NOT registered in the shared Root.tsx/registry.ts.
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { ArrowDown } from "./ArrowDown.js";

export const ctaOlaSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  linea1: z.string().default("ESCRÍBENOS"),
  linea2: z.string().default("POR WHATSAPP"),
  posicionYFrac: z.number().min(0).max(1).default(0.8),
  colorLinea1: z.string().default("#FFFFFF"),
  colorLinea2: z.string().default("#5FD9F5"),
  tamano1: z.number().positive().default(96),
  tamano2: z.number().positive().default(112),
  amplitudPx: z.number().nonnegative().default(7),
  cicloSeg: z.number().positive().default(6),
  escalonSeg: z.number().nonnegative().default(0.04),
  /** Flecha (movistar-flecha-abajo) */
  colorFlecha: z.string().default("#3EC6FF"),
  tamanoFlecha: z.number().positive().default(90),
  /** Segundos que tarda en aparecer la flecha una vez asentado el texto. */
  retrasoFlechaSeg: z.number().nonnegative().default(1.1),
  /** Distancia (px) del centro del texto al centro de la flecha. */
  distanciaFlechaPx: z.number().default(210),
});

export type CtaOlaProps = z.infer<typeof ctaOlaSchema>;

function Linea({ texto, tamano, color, offset, p }: { texto: string; tamano: number; color: string; offset: number; p: CtaOlaProps }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", justifyContent: "center", whiteSpace: "pre", fontFamily: "'Grift Black', system-ui, sans-serif", fontSize: tamano, color, lineHeight: 0.98, textShadow: "0 5px 14px rgba(10,40,120,0.4)" }}>
      {Array.from(texto).map((ch, i) => {
        const idx = offset + i;
        const start = Math.round(idx * p.escalonSeg * fps);
        const entrada = spring({ frame: frame - start, fps, config: { damping: 12, stiffness: 170, mass: 0.7 } });
        const fase = (frame / (p.cicloSeg * fps)) * Math.PI * 2 - idx * 0.55;
        const ola = Math.sin(fase) * p.amplitudPx * Math.min(1, Math.max(0, entrada));
        const sube = (1 - entrada) * tamano * 0.9;
        return (
          <span key={i} style={{ display: "inline-block", transform: `translateY(${sube + ola}px) rotate(${Math.sin(fase + 0.8) * 1.2}deg) scale(${0.6 + 0.4 * Math.min(1, entrada)})`, opacity: Math.min(1, entrada * 1.6) }}>
            {ch}
          </span>
        );
      })}
    </div>
  );
}

export function CtaOla(props: CtaOlaProps) {
  const { width, height, durationSec, fps, linea1, linea2, posicionYFrac, colorLinea1, colorLinea2, tamano1, tamano2, colorFlecha, tamanoFlecha, retrasoFlechaSeg, distanciaFlechaPx } = props;
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const salida = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const from = Math.round(retrasoFlechaSeg * fps);
  const flechaY = (height * posicionYFrac + distanciaFlechaPx) / height;
  return (
    <AbsoluteFill style={{ opacity: salida }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: height * posicionYFrac, transform: "translateY(-50%)", textAlign: "center" }}>
        <Linea texto={linea1} tamano={tamano1} color={colorLinea1} offset={0} p={props} />
        <Linea texto={linea2} tamano={tamano2} color={colorLinea2} offset={linea1.length} p={props} />
      </div>
      <Sequence from={from} layout="none">
        <ArrowDown durationSec={durationSec} fps={fps} width={width} height={height} color={colorFlecha} posicionXFrac={0.5} posicionYFrac={flechaY} tamano={tamanoFlecha} cantidadChevrones={3} velocidadSeg={1.1} />
      </Sequence>
    </AbsoluteFill>
  );
}
