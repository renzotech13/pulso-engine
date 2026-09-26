// Standalone composition: centered 3-line headline where EVERY letter moves on
// its own — a staggered spring entrance (letters rise in one after another,
// left to right) and then a constant, gentle sea-wave bob (phase shifted per
// letter and per line). New file; nothing existing is touched. NOT registered
// in the shared Root.tsx/registry.ts.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const tituloOlasSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  linea1: z.string().default("SEÑAL Y DATOS"),
  linea2: z.string().default("ILIMITADOS"),
  linea3: z.string().default("EN TODO EL PERÚ"),
  posicionYFrac: z.number().min(0).max(1).default(0.22),
  colorLinea1: z.string().default("#FFFFFF"),
  colorLinea2: z.string().default("#5FD9F5"),
  colorLinea3: z.string().default("#FFFFFF"),
  tamano1: z.number().positive().default(112),
  tamano2: z.number().positive().default(170),
  tamano3: z.number().positive().default(70),
  /** Amplitud de la ola (px) y segundos por ciclo. */
  amplitudPx: z.number().nonnegative().default(7),
  cicloSeg: z.number().positive().default(6),
  /** Retraso entre letras en la entrada (segundos). */
  escalonSeg: z.number().nonnegative().default(0.04),
});

export type TituloOlasProps = z.infer<typeof tituloOlasSchema>;

function Linea({ texto, tamano, color, offset, props }: { texto: string; tamano: number; color: string; offset: number; props: TituloOlasProps }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letras = Array.from(texto);
  return (
    <div style={{ display: "flex", justifyContent: "center", whiteSpace: "pre", fontFamily: "'Grift Black', system-ui, sans-serif", fontSize: tamano, color, lineHeight: 0.98, textShadow: "0 5px 14px rgba(10,40,120,0.35)" }}>
      {letras.map((ch, i) => {
        const idx = offset + i;
        const start = Math.round(idx * props.escalonSeg * fps);
        const entrada = spring({ frame: frame - start, fps, config: { damping: 12, stiffness: 170, mass: 0.7 } });
        const fase = (frame / (props.cicloSeg * fps)) * Math.PI * 2 - idx * 0.55;
        // la ola arranca suave cuando la letra ya llegó
        const ola = Math.sin(fase) * props.amplitudPx * Math.min(1, Math.max(0, entrada));
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

export function TituloOlas(props: TituloOlasProps) {
  const { height, posicionYFrac, linea1, linea2, linea3, colorLinea1, colorLinea2, colorLinea3, tamano1, tamano2, tamano3 } = props;
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const salida = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: height * posicionYFrac, transform: "translateY(-50%)", opacity: salida, textAlign: "center" }}>
        <Linea texto={linea1} tamano={tamano1} color={colorLinea1} offset={0} props={props} />
        <Linea texto={linea2} tamano={tamano2} color={colorLinea2} offset={linea1.length} props={props} />
        <Linea texto={linea3} tamano={tamano3} color={colorLinea3} offset={linea1.length + linea2.length} props={props} />
      </div>
    </AbsoluteFill>
  );
}
