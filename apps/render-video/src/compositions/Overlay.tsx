import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { OverlayProps } from "./overlay.schema";

export { overlaySchema, type OverlayProps } from "./overlay.schema";

/**
 * Fase 2: the full brand preset — title card/overlay in the first N
 * seconds, styled subtitles (karaoke highlight, outline, shadow, background
 * box, safe-area margin) for the rest. Renders on a transparent background;
 * video-editor's render.ts asks for an alpha-capable codec and ffmpeg
 * composites this over the real footage afterward (see render.ts's
 * comment on why: Remotion draws graphics, ffmpeg owns the source video
 * and the final encode).
 */
export function Overlay({ subtitulos, subtituloEstilo, titulo, fuente, width }: OverlayProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const activeBlock = subtitulos.find((b) => t >= b.startSec && t < b.endSec);
  const showTitle = titulo !== undefined && t < titulo.duracionSeg;

  return (
    <AbsoluteFill style={{ fontFamily: fuente.archivo ? fuente.familia : "system-ui, -apple-system, sans-serif" }}>
      {fuente.archivo && (
        <style>{`@font-face{font-family:"${fuente.familia}";src:url("${fuente.archivo}");font-weight:${fuente.peso};}`}</style>
      )}
      {showTitle && <TitleLayer titulo={titulo} t={t} width={width} />}
      {activeBlock && <SubtitleLayer block={activeBlock} estilo={subtituloEstilo} t={t} />}
    </AbsoluteFill>
  );
}

const JUSTIFY_BY_POSITION = { superior: "flex-start", centro: "center", inferior: "flex-end" } as const;

function backgroundCss(fondo: { activo: boolean; color: string; radio: number; padding: number } | undefined) {
  if (!fondo?.activo) return {};
  return { backgroundColor: fondo.color, borderRadius: fondo.radio, padding: fondo.padding };
}

function TitleLayer({ titulo, t, width }: { titulo: NonNullable<OverlayProps["titulo"]>; t: number; width: number }) {
  const enter = titulo.animacionEntrada === "fadeIn" && titulo.entradaSeg > 0 ? interpolate(t, [0, titulo.entradaSeg], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const exitStart = titulo.duracionSeg - titulo.salidaSeg;
  const exit = titulo.animacionSalida === "fadeOut" && titulo.salidaSeg > 0 ? interpolate(t, [exitStart, titulo.duracionSeg], [1, 0], { extrapolateLeft: "clamp" }) : 1;
  const opacity = Math.min(enter, exit);

  // "tarjeta" replaces the footage for its duration rather than sitting on
  // top of it — since ffmpeg composites this whole layer over the video
  // with a plain `overlay` filter, an OPAQUE full-frame background here is
  // what makes that swap happen; "superpuesto" leaves the rest transparent
  // so the video shows through everywhere the title box doesn't cover.
  const isCard = titulo.modo === "tarjeta";

  return (
    <AbsoluteFill
      style={{
        opacity,
        display: "flex",
        flexDirection: "column",
        justifyContent: JUSTIFY_BY_POSITION[titulo.posicion],
        alignItems: "center",
        backgroundColor: isCard ? (titulo.fondo?.activo ? titulo.fondo.color : "#000000") : undefined,
      }}
    >
      <div
        style={{
          maxWidth: width * 0.86,
          textAlign: "center",
          fontWeight: 800,
          fontSize: titulo.tamano,
          color: titulo.color,
          lineHeight: 1.2,
          ...(isCard ? {} : backgroundCss(titulo.fondo)),
        }}
      >
        {titulo.texto}
      </div>
    </AbsoluteFill>
  );
}

/** Same greedy word-wrap as video-editor's subtitles.ts (wrapIntoLines) but kept on word OBJECTS, not a joined string — each word needs to stay addressable for the karaoke color pass. Deliberately duplicated rather than shared: see overlay.schema.ts's note on why this package doesn't import video-editor. */
function wrapWordsIntoLines<T extends { text: string }>(words: readonly T[], maxCharsPerLine: number, maxLines: number): T[][] {
  const lines: T[][] = [];
  let current: T[] = [];
  let currentLength = 0;

  for (const word of words) {
    const addedLength = currentLength === 0 ? word.text.length : currentLength + 1 + word.text.length;
    const onLastAllowedLine = lines.length === maxLines - 1;
    if (addedLength > maxCharsPerLine && current.length > 0 && !onLastAllowedLine) {
      lines.push(current);
      current = [word];
      currentLength = word.text.length;
    } else {
      current.push(word);
      currentLength = addedLength;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function SubtitleLayer({ block, estilo, t }: { block: OverlayProps["subtitulos"][number]; estilo: OverlayProps["subtituloEstilo"]; t: number }) {
  const lines = wrapWordsIntoLines(block.words, estilo.maxCaracteresPorLinea, estilo.maxLineas);

  const animation = estilo.animacion === "pop" ? 1 : 0;
  const sinceBlockStart = Math.max(0, t - block.startSec);
  // spring() takes a frame count, not seconds — 30fps is a safe assumption
  // for the pop-in's timing feel even at a different output fps, since it
  // only affects how many frames the spring interpolates over, not the
  // wall-clock duration much (spring is frame-rate-aware internally).
  const popScale = animation ? spring({ frame: Math.round(sinceBlockStart * 30), fps: 30, config: { damping: 12, stiffness: 200 } }) : 1;

  const textShadow = [
    estilo.sombra ? `0 ${estilo.sombra.desplazamiento}px 4px ${estilo.sombra.color}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: JUSTIFY_BY_POSITION[estilo.posicion],
        alignItems: "center",
        paddingBottom: estilo.posicion === "inferior" ? estilo.margenSeguroInferiorPx : undefined,
        paddingTop: estilo.posicion === "superior" ? estilo.margenSeguroInferiorPx : undefined,
        transform: `scale(${popScale})`,
      }}
    >
      <div style={{ textAlign: "center", ...backgroundCss(estilo.fondo) }}>
        {lines.map((line, lineIndex) => (
          <div key={lineIndex} style={{ whiteSpace: "nowrap" }}>
            {line.map((word, wordIndex) => {
              const isActive = estilo.resaltarPalabraActiva && t >= word.startSec && t < word.endSec;
              return (
                <span
                  key={wordIndex}
                  style={{
                    fontSize: estilo.tamano,
                    fontWeight: 700,
                    textTransform: estilo.mayusculas ? "uppercase" : "none",
                    color: isActive ? estilo.colorPalabraActiva : estilo.color,
                    WebkitTextStroke: estilo.contorno ? `${estilo.contorno.grosor}px ${estilo.contorno.color}` : undefined,
                    textShadow: textShadow || undefined,
                  }}
                >
                  {word.text}
                  {wordIndex < line.length - 1 ? " " : ""}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}
