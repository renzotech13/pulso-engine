import { useEffect } from "react";
import { AbsoluteFill, continueRender, delayRender, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
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
/**
 * A `@font-face` rule alone only tells the browser WHERE the font is —
 * nothing makes a frame wait for it to actually finish downloading before
 * getting captured. Every preset tested before this one omitted
 * `fuente.archivo` entirely (falling back to the system stack, which needs
 * no network fetch), so this gap never showed up until a preset with a real
 * custom font — AZ Estudio Contable's Inter Tight, fetched from Google
 * Fonts' CDN — rendered blank/fallback text on the first frames. Loading it
 * explicitly via the FontFace API inside a delayRender/continueRender pair
 * makes Remotion actually hold every frame of this composition until the
 * font is ready, the same guarantee `@remotion/fonts` provides for its own
 * bundled fonts.
 */
function useCustomFont(familia: string, archivo: string | undefined, peso: number): void {
  useEffect(() => {
    if (!archivo) return;
    const handle = delayRender(`loading font "${familia}" from ${archivo}`);
    const fontFace = new FontFace(familia, `url("${archivo}")`, { weight: String(peso) });
    fontFace
      .load()
      .then((loaded) => {
        // TypeScript's DOM lib omits `add` from its FontFaceSet typing even
        // though every browser (this runs in headless Chromium) implements
        // it per spec — a long-standing gap in lib.dom.d.ts, not a runtime
        // concern.
        (document.fonts as FontFaceSet & { add(font: FontFace): void }).add(loaded);
        continueRender(handle);
      })
      .catch((err: unknown) => {
        // A font that fails to load (network hiccup, bad URL) shouldn't take
        // the whole render down — the text still renders, just in the
        // system fallback stack instead of the brand's real typeface.
        console.warn(`[render-video] no se pudo cargar la fuente "${familia}": ${String(err)}`);
        continueRender(handle);
      });
    // Deliberately no cancelRender on unmount: this composition's lifetime
    // IS the render's lifetime (Remotion doesn't remount it mid-render), so
    // there's no cleanup case where the handle would otherwise leak.
  }, [familia, archivo, peso]);
}

export function Overlay({ subtitulos, subtituloEstilo, titulo, fuente, width }: OverlayProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  useCustomFont(fuente.familia, fuente.archivo, fuente.peso);

  const activeBlock = subtitulos.find((b) => t >= b.startSec && t < b.endSec);
  const showTitle = titulo !== undefined && t < titulo.duracionSeg;

  return (
    <AbsoluteFill style={{ fontFamily: fuente.archivo ? fuente.familia : "system-ui, -apple-system, sans-serif" }}>
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
        paddingTop: titulo.posicion === "superior" ? titulo.margenSeguroPx : undefined,
        paddingBottom: titulo.posicion === "inferior" ? titulo.margenSeguroPx : undefined,
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
                    // Without this, Chromium paints the stroke ON TOP of the
                    // fill instead of behind it — visible on real renders as
                    // dark gashes cutting across diagonal strokes ("A", "R")
                    // wherever the two passes don't align pixel-for-pixel.
                    // `paintOrder: "stroke"` draws the stroke first so the
                    // fill fully covers it except at the true outline edge,
                    // which is the entire point of an outline. Confirmed by
                    // rendering both versions of this exact word list and
                    // comparing the frames.
                    paintOrder: estilo.contorno ? "stroke" : undefined,
                    WebkitTextFillColor: isActive ? estilo.colorPalabraActiva : estilo.color,
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
