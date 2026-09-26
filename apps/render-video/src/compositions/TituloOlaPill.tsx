// Standalone composition: top line whose letters each move on their own (same
// entrance + slow constant sea-wave as TituloOlas) over a solid rounded pill
// that BOUNCES in (spring, like TituloPill) holding a second line. New file;
// nothing existing is touched. NOT registered in the shared Root.tsx/registry.ts.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

export const tituloOlaPillSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  texto1: z.string().default("¿PAGAS MÁS DE"),
  texto2: z.string().default("S/ 50 EN CLARO O ENTEL?"),
  posicionYFrac: z.number().min(0).max(1).default(0.15),
  colorTexto1: z.string().default("#0A1E3C"),
  colorTexto2: z.string().default("#FFFFFF"),
  colorPill: z.string().default("#3B86E6"),
  tamano1: z.number().positive().default(110),
  tamano2: z.number().positive().default(78),
  amplitudPx: z.number().nonnegative().default(7),
  cicloSeg: z.number().positive().default(6),
  escalonSeg: z.number().nonnegative().default(0.04),
  /** Segundo en que entra el pill con rebote (después de que las letras de arriba terminan de subir). */
  entradaPillSeg: z.number().nonnegative().default(0.7),
});

export type TituloOlaPillProps = z.infer<typeof tituloOlaPillSchema>;

export function TituloOlaPill(props: TituloOlaPillProps) {
  const { height, texto1, texto2, posicionYFrac, colorTexto1, colorTexto2, colorPill, tamano1, tamano2, amplitudPx, cicloSeg, escalonSeg, entradaPillSeg } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const salida = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fuente = "'Grift Black', system-ui, sans-serif";

  const pillStart = Math.round(entradaPillSeg * fps);
  const sPill = spring({ frame: frame - pillStart, fps, config: { damping: 8, stiffness: 240, mass: 0.6 } });
  const sTexto = spring({ frame: frame - pillStart - 6, fps, config: { damping: 9, stiffness: 260, mass: 0.6 } });

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: height * posicionYFrac, transform: "translateY(-50%)", opacity: salida, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", whiteSpace: "pre", fontFamily: fuente, fontSize: tamano1, color: colorTexto1, lineHeight: 1 }}>
          {Array.from(texto1).map((ch, i) => {
            const start = Math.round(i * escalonSeg * fps);
            const entrada = spring({ frame: frame - start, fps, config: { damping: 12, stiffness: 170, mass: 0.7 } });
            const fase = (frame / (cicloSeg * fps)) * Math.PI * 2 - i * 0.55;
            const ola = Math.sin(fase) * amplitudPx * Math.min(1, Math.max(0, entrada));
            const sube = (1 - entrada) * tamano1 * 0.9;
            return (
              <span key={i} style={{ display: "inline-block", transform: `translateY(${sube + ola}px) rotate(${Math.sin(fase + 0.8) * 1.2}deg) scale(${0.6 + 0.4 * Math.min(1, entrada)})`, opacity: Math.min(1, entrada * 1.6) }}>
                {ch}
              </span>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: tamano1 * 0.12 }}>
          <div style={{ display: "inline-block", background: colorPill, borderRadius: tamano2 * 0.55, padding: `${tamano2 * 0.16}px ${tamano2 * 0.5}px ${tamano2 * 0.2}px`, transform: `scale(${Math.max(0, sPill)})`, transformOrigin: "center" }}>
            <div style={{ fontFamily: fuente, fontSize: tamano2, color: colorTexto2, lineHeight: 1, whiteSpace: "nowrap", transform: `scale(${Math.max(0, sTexto)})` }}>{texto2}</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
