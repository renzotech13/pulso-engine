// Standalone, self-contained composition for a small blinking "scroll/tap
// down" indicator — a stack of chevrons that pulse in sequence top-to-bottom,
// like a tech UI hint pointing at something below it. Same isolation rule as
// PrecioCard.tsx/FeatureCards.tsx: deliberately NOT registered in the shared
// Root.tsx/registry.ts, so nothing here can reach AZ/Aura or any other
// tenant's renders.
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";

export const arrowDownSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  color: z.string(),
  // Horizontal/vertical center of the whole indicator, as a fraction of frame size.
  posicionXFrac: z.number().min(0).max(1),
  posicionYFrac: z.number().min(0).max(1),
  tamano: z.number().positive().default(90),
  // How many stacked chevrons make up the indicator.
  cantidadChevrones: z.number().int().min(1).max(4).default(3),
  // Seconds per pulse cycle (one chevron lighting up after another, top to bottom).
  velocidadSeg: z.number().positive().default(1.1),
});

export type ArrowDownProps = z.infer<typeof arrowDownSchema>;

function Chevron({ size, color, opacity, glow }: { size: number; color: string; opacity: number; glow: number }) {
  // A single downward chevron ("v"), drawn as a stroked path so its weight
  // stays consistent regardless of size.
  return (
    <svg
      width={size}
      height={size * 0.55}
      viewBox="0 0 100 55"
      style={{ opacity, filter: `drop-shadow(0 0 ${glow}px ${color})` }}
    >
      <path d="M6 6 L50 46 L94 6" fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowDown(props: ArrowDownProps) {
  const { width, height, color, posicionXFrac, posicionYFrac, tamano, cantidadChevrones, velocidadSeg, fps } = props;
  const frame = useCurrentFrame();
  const tSec = frame / fps;

  // Each chevron's own pulse is offset from the one above it, so the "light"
  // reads as flowing downward instead of every chevron blinking together.
  const stepOffsetSec = velocidadSeg / (cantidadChevrones + 1);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: width * posicionXFrac,
          top: height * posicionYFrac,
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: -tamano * 0.18,
        }}
      >
        {Array.from({ length: cantidadChevrones }).map((_, i) => {
          const localT = ((tSec - i * stepOffsetSec) % velocidadSeg + velocidadSeg) % velocidadSeg;
          const phase = localT / velocidadSeg;
          // Sharp-in, soft-out pulse: quick brighten then fade, not a plain sine — reads more like a tech "ping" than a lava-lamp glow.
          const pulse = phase < 0.25 ? interpolate(phase, [0, 0.25], [0.25, 1]) : interpolate(phase, [0.25, 1], [1, 0.25]);
          return <Chevron key={i} size={tamano} color={color} opacity={pulse} glow={pulse * tamano * 0.22} />;
        })}
      </div>
    </AbsoluteFill>
  );
}
