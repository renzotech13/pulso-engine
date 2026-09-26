import { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
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
interface FontSpec {
  familia: string;
  archivo?: string | undefined;
  peso: number;
}

/**
 * Loads every font that has an `archivo` (a system font needs no network
 * fetch, so it's skipped) and blocks frame capture until ALL of them are
 * ready — one delayRender/continueRender pair covering the whole batch,
 * rather than one per font, so a "tresNiveles" título's 3 distinct typefaces
 * are exactly as safe against the blank-frame race as the single global
 * `fuente` always was (see the block comment above on why this exists at
 * all — Chromium never held a frame for a still-downloading @font-face on
 * its own).
 */
function useCustomFonts(fonts: readonly FontSpec[]): number {
  // Bumped once every font in the batch has loaded. Nothing re-renders on
  // its own when a font arrives, and `ajustarAlAncho` MEASURES text during
  // render — measured against the fallback stack, that measurement (and so
  // the fitted font size) would be silently wrong for any preset whose
  // fonts come from `archivo`. Returning a version the caller can depend on
  // is what forces the re-measure. Presets whose fonts are OS-installed
  // (no `archivo`) never load anything, so this stays 0 and nothing re-runs.
  const [loadedVersion, setLoadedVersion] = useState(0);
  // FontSpec objects are rebuilt every render — key on their actual content
  // so the effect only re-runs when a font really changed, not every frame.
  const key = fonts.map((f) => `${f.familia}|${f.archivo ?? ""}|${f.peso}`).join(";");
  useEffect(() => {
    const toLoad = fonts.filter((f): f is FontSpec & { archivo: string } => Boolean(f.archivo));
    if (toLoad.length === 0) return;
    const handle = delayRender(`loading fonts: ${toLoad.map((f) => f.familia).join(", ")}`);
    Promise.all(
      toLoad.map((f) =>
        new FontFace(f.familia, `url("${f.archivo}")`, { weight: String(f.peso) })
          .load()
          .then((loaded) => {
            // TypeScript's DOM lib omits `add` from its FontFaceSet typing
            // even though every browser (this runs in headless Chromium)
            // implements it per spec — a long-standing gap in lib.dom.d.ts,
            // not a runtime concern.
            (document.fonts as FontFaceSet & { add(font: FontFace): void }).add(loaded);
          })
          .catch((err: unknown) => {
            // A font that fails to load (network hiccup, bad URL) shouldn't
            // take the whole render down — the text still renders, just in
            // the system fallback stack instead of the brand's real typeface.
            console.warn(`[render-video] no se pudo cargar la fuente "${f.familia}": ${String(err)}`);
          }),
      ),
    ).finally(() => {
      // Before continueRender on purpose: the re-measure has to be committed
      // by the time Remotion captures the frame, not after it.
      setLoadedVersion((v) => v + 1);
      continueRender(handle);
    });
    // Deliberately no cancelRender on unmount: this composition's lifetime
    // IS the render's lifetime (Remotion doesn't remount it mid-render), so
    // there's no cleanup case where the handle would otherwise leak.
    //
    // Only `key` (the fonts' own content) drives this effect — `fonts` is a
    // fresh array/objects every render, so depending on it directly would
    // re-run (and re-delayRender) every frame instead of once per real change.
  }, [key]);
  return loadedVersion;
}

export function Overlay({ subtitulos, subtituloEstilo, titulo, fuente, width }: OverlayProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const tresNivelesFonts =
    titulo?.estilo === "tresNiveles" && titulo.tresNiveles
      ? [titulo.tresNiveles.superior.fuente, titulo.tresNiveles.medio.fuente, titulo.tresNiveles.inferior.fuente]
      : [];
  const fontsVersion = useCustomFonts([fuente, ...tresNivelesFonts, ...(subtituloEstilo.fuente ? [subtituloEstilo.fuente] : [])]);

  const activeBlock = subtitulos.find((b) => t >= b.startSec && t < b.endSec);
  const showTitle = titulo !== undefined && t < titulo.duracionSeg;

  return (
    <AbsoluteFill style={{ fontFamily: fuente.archivo ? fuente.familia : "system-ui, -apple-system, sans-serif" }}>
      {showTitle && <TitleLayer titulo={titulo} t={t} fps={fps} width={width} fontsVersion={fontsVersion} />}
      {activeBlock && <SubtitleLayer block={activeBlock} estilo={subtituloEstilo} t={t} width={width} fuente={fuente} />}
      {subtituloEstilo.marca && subtitulos.length > 0 && <MarcaLayer estilo={subtituloEstilo} />}
    </AbsoluteFill>
  );
}

/** Firma fija bajo la línea de subtítulos (p. ej. "@azestudiocontable"): siempre visible, aunque entre un bloque y otro no haya texto. */
function MarcaLayer({ estilo }: { estilo: OverlayProps["subtituloEstilo"] }) {
  const m = estilo.marca!;
  const k = m.acento ? m.texto.toLowerCase().indexOf(m.acento.toLowerCase(), m.texto.startsWith("@") ? 1 : 0) : -1;
  // La línea de subtítulos va centrada en su posición: la firma cuelga justo debajo (media línea + margen).
  const offset = Math.round(estilo.tamano * 0.575 + m.margenSuperiorPx);
  const top = estilo.posicion === "centro" ? `calc(50% + ${offset}px)` : estilo.posicion === "superior" ? `${estilo.margenSeguroInferiorPx + estilo.tamano * 1.15 + m.margenSuperiorPx}px` : undefined;
  const bottom = estilo.posicion === "inferior" ? Math.max(0, estilo.margenSeguroInferiorPx - m.tamano * 1.3 - m.margenSuperiorPx) : undefined;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        bottom,
        textAlign: "center",
        whiteSpace: "nowrap",
        fontSize: m.tamano,
        fontWeight: 700,
        lineHeight: 1.15,
        color: m.color,
        textShadow: textShadowCss(estilo.sombra),
        fontFamily: estilo.fuente?.familia,
      }}
    >
      {k < 0 ? (
        m.texto
      ) : (
        <>
          {m.texto.slice(0, k)}
          <span style={{ color: m.colorAcento }}>{m.texto.slice(k, k + m.acento.length)}</span>
          {m.texto.slice(k + m.acento.length)}
        </>
      )}
    </div>
  );
}

const JUSTIFY_BY_POSITION = { superior: "flex-start", centro: "center", inferior: "flex-end" } as const;

function backgroundCss(fondo: { activo: boolean; color: string; radio: number; padding: number } | undefined) {
  if (!fondo?.activo) return {};
  return { backgroundColor: fondo.color, borderRadius: fondo.radio, padding: fondo.padding };
}

// Stacked lines (the "tresNiveles" template) enter/exit one after another
// instead of all at once — this is the gap between each line's own window.
const TITLE_LINE_STAGGER_SEC = 0.08;

/**
 * A line's own entrance/exit windows, staggered by `lineIndex` — index 0
 * (the "simple" título's only line, or "tresNiveles"'s top line) always
 * keeps the exact windows the old single-line código used ([0, entradaSeg]
 * entering, [duracionSeg - salidaSeg, duracionSeg] exiting), so this is a
 * strict generalization, not a behavior change, for every preset that
 * doesn't use "tresNiveles". Later lines enter later and — since exitEnd
 * counts backward from duracionSeg — finish exiting earlier, so the whole
 * stack closes in the same top-to-bottom order it opened in in reverse:
 * inferior first, superior last, landing exactly on duracionSeg like today.
 */
function lineWindow(lineIndex: number, entradaSeg: number, salidaSeg: number, duracionSeg: number) {
  const enterStart = lineIndex * TITLE_LINE_STAGGER_SEC;
  const exitEnd = duracionSeg - lineIndex * TITLE_LINE_STAGGER_SEC;
  return {
    enterStart,
    enterEnd: enterStart + entradaSeg,
    exitStart: exitEnd - salidaSeg,
    exitEnd,
  };
}

/** Combined entrance+exit progress (0=hidden, 1=fully shown) for one animation TYPE (fade or wipe) — `Math.min` is the same "never let entrance and exit fight" rule the old single-line opacity used. */
function lineProgress(
  t: number,
  lineIndex: number,
  titulo: NonNullable<OverlayProps["titulo"]>,
  entradaTipo: "fadeIn" | "wipeVertical",
  salidaTipo: "fadeOut" | "wipeVertical",
): number {
  const w = lineWindow(lineIndex, titulo.entradaSeg, titulo.salidaSeg, titulo.duracionSeg);
  const enter =
    titulo.animacionEntrada === entradaTipo && titulo.entradaSeg > 0
      ? interpolate(t, [w.enterStart, w.enterEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
  const exit =
    titulo.animacionSalida === salidaTipo && titulo.salidaSeg > 0
      ? interpolate(t, [w.exitStart, w.exitEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
  return Math.min(enter, exit);
}

/** One line's full CSS for whichever animation its título actually asked for — opacity for fadeIn/fadeOut, a vertical mask for wipeVertical, both defaulting to "fully shown" when that line's field isn't set to that type. */
function lineAnimationStyle(t: number, lineIndex: number, titulo: NonNullable<OverlayProps["titulo"]>): { opacity: number; clipPath: string | undefined } {
  const opacity = lineProgress(t, lineIndex, titulo, "fadeIn", "fadeOut");
  const wipeProgress = lineProgress(t, lineIndex, titulo, "wipeVertical", "wipeVertical");
  // Reveals top-down as wipeProgress grows (entrance) and closes the exact
  // same way in reverse as it shrinks back (exit) — one formula, run
  // forward then backward, rather than two separate mask directions.
  const clipPath = wipeProgress < 1 ? `inset(0 0 ${(1 - wipeProgress) * 100}% 0)` : undefined;
  return { opacity, clipPath };
}

type NivelEstilo = NonNullable<NonNullable<OverlayProps["titulo"]>["tresNiveles"]>["superior"];
interface Window {
  enterStart: number;
  enterEnd: number;
  exitStart: number;
  exitEnd: number;
}

/** Same `0 <offset>px 4px <color>` shape SubtitleLayer builds inline — factored out here since a nivel and a subtítulo block both carry an optional `{ color, desplazamiento }` shadow in the same shape. */
function textShadowCss(
  sombra: { color: string; desplazamiento: number; blur?: number | undefined; halo?: boolean | undefined; grosorPx?: number | undefined } | undefined,
): string | undefined {
  if (!sombra) return undefined;
  const blur = sombra.blur ?? 4;
  const base = `0 ${sombra.desplazamiento}px ${blur}px ${sombra.color}`;
  // "halo": segunda capa sin desplazamiento, más difusa, que oscurece el borde de la letra sobre fondos claros.
  const halo = sombra.halo ? `, 0 0 ${Math.round(blur * 1.5)}px ${sombra.color}` : "";
  // "grosorPx": tercera capa, pegada al borde de la letra y con blur chico
  // — a diferencia de `blur`/`halo` (que solo se expanden hacia afuera),
  // esta suma densidad/opacidad justo en el trazo, dándole "cuerpo" además
  // del brillo difuso de las otras dos.
  const grosor = sombra.grosorPx ? `, 0 0 ${sombra.grosorPx}px ${sombra.color}, 0 0 ${sombra.grosorPx}px ${sombra.color}` : "";
  return `${base}${halo}${grosor}`;
}

// One canvas reused for every measurement — creating one per call would
// allocate a fresh (never-painted) element on every frame of every render.
let measureCanvas: HTMLCanvasElement | undefined;

/**
 * Width this exact text would occupy, in px, at a given font size. Uses the
 * canvas 2D text metrics rather than laying the text out in the DOM and
 * reading it back: measuring is synchronous and side-effect free, so it can
 * run during render and produce the SAME number on every frame — a DOM
 * measure-then-resize pass would need a second render pass per frame and
 * risks a one-frame flash of the unfitted size.
 */
function measureTextPx(text: string, fontSize: number, fuente: NivelEstilo["fuente"], trackingPx: number): number {
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = `${fuente.peso} ${fontSize}px "${fuente.familia}"`;
  // measureText knows nothing about CSS letter-spacing, which the rendered
  // line DOES carry (nivel.trackingPx) — Chromium adds it after every
  // character, including the last one, so it's `length`, not `length - 1`.
  return ctx.measureText(text).width + trackingPx * text.length;
}

// A measurement of 0 (font missing, empty text) would otherwise divide into
// an absurd size; this caps how far a single fit is ever allowed to grow.
const AJUSTE_MAX_ESCALA = 8;

// Fraction of the available width a fitted line is allowed to occupy — see fitNivelToWidth for why it isn't 1.
const ANCHO_SEGURO_FRAC = 0.94;

/**
 * Returns the nivel with its `tamano`/`trackingPx` scaled so the line fills
 * `availableWidth` exactly — the answer to "I want it bigger but it keeps
 * wrapping": the width of the frame, not a number typed by hand, decides
 * the size. Levels without `ajustarAlAncho` come back untouched.
 */
function fitNivelToWidth(nivel: NivelEstilo, availableWidth: number): NivelEstilo {
  if ((!nivel.ajustarAlAncho && !nivel.reducirAlAncho) || !nivel.texto) return nivel;
  // The rendered line is uppercased by CSS when `mayusculas` is set, and
  // capitals are wider — measuring the original casing would under-measure
  // and overflow the frame.
  const texto = nivel.mayusculas ? nivel.texto.toUpperCase() : nivel.texto;
  const medido = measureTextPx(texto, nivel.tamano, nivel.fuente, nivel.trackingPx);
  if (!Number.isFinite(medido) || medido <= 0) return nivel;
  // canvas measureText only reports the glyph ADVANCE width; a swashy
  // script face (Mrs Hannah's "C", "r") paints past it on both sides — a
  // real render clipped the "r" of "Color" at the frame edge even though
  // the measurement said it fit. Fitting to a bit less than the container
  // leaves room for that overhang.
  const objetivo = availableWidth * ANCHO_SEGURO_FRAC;
  let escala = objetivo / medido;
  if (nivel.ajustarAlAncho) {
    escala = Math.min(escala, AJUSTE_MAX_ESCALA);
    if (nivel.tamanoMaximo !== undefined) escala = Math.min(escala, nivel.tamanoMaximo / nivel.tamano);
  } else {
    // reducirAlAncho: shrink-only, never enlarge.
    escala = Math.min(escala, 1);
  }
  // The negative top margin was tuned for the nominal size — keep it proportional when the line shrinks so levels don't pile up.
  const margenSuperiorPx = nivel.margenSuperiorPx < 0 && escala < 1 ? nivel.margenSuperiorPx * escala : nivel.margenSuperiorPx;
  return { ...nivel, tamano: nivel.tamano * escala, trackingPx: nivel.trackingPx * escala, margenSuperiorPx };
}

/** Same shared font/color/case/spacing styling every nivel effect below draws its text with — only `letterSpacing` itself varies per effect (letrasJuntan doesn't use it at all), so it's left out here. */
function nivelFontStyle(nivel: NivelEstilo) {
  return {
    fontFamily: nivel.fuente.familia,
    fontWeight: nivel.fuente.peso,
    fontSize: nivel.tamano,
    color: nivel.color,
    textTransform: nivel.mayusculas ? ("uppercase" as const) : ("none" as const),
    lineHeight: nivel.interlineado,
    textAlign: nivel.alineacion === "izquierda" ? ("left" as const) : nivel.alineacion === "derecha" ? ("right" as const) : ("center" as const),
    // Pulls this level closer to (negative) or further from (positive) the
    // one above it — plain lineHeight alone can't tighten the gap between
    // two DIFFERENT font sizes the way a per-level margin can.
    marginTop: nivel.margenSuperiorPx,
    // Nudges this line in from whichever edge `alineacion` pinned it to,
    // toward the center — no effect when alineacion is "centro".
    marginLeft: nivel.alineacion === "izquierda" ? nivel.sangriaPx : undefined,
    marginRight: nivel.alineacion === "derecha" ? nivel.sangriaPx : undefined,
    // Visual-only horizontal nudge for this line alone: the CSS `translate`
    // property (not `transform`) so it composes independently of the
    // `transform: translateY(...)` a mascaraVertical nivel gets at its call
    // site below — that one wins/loses no ground to this one, and this one
    // doesn't affect layout/width the way a margin would (no risk of
    // pushing the line into an unwanted wrap the way a wide marginLeft can).
    translate: nivel.desplazamientoXPx ? `${nivel.desplazamientoXPx}px 0` : undefined,
    // Optional and per-level (a bright take might only need it on one of
    // the 3 lines) — see preset.ts's nivelTituloSchema.sombra and
    // titulo-cli.ts's --sombra flag, which is what actually flips this for
    // all 3 levels at once without hand-editing the preset JSON.
    textShadow: textShadowCss(nivel.sombra),
    // A fitted line is sized to land just inside the container; a stray
    // sub-pixel rounding the other way would wrap it and undo the whole
    // point, so it's pinned to one line explicitly.
    whiteSpace: nivel.ajustarAlAncho || nivel.reducirAlAncho ? ("nowrap" as const) : undefined,
  };
}

/** Same "never let entrance and exit fight" Math.min rule as lineProgress, but independent of the título's shared animacionEntrada/animacionSalida — a nivel's own `efecto` (mascaraVertical/letrasOla/letrasJuntan) always runs regardless of what those fields say. */
function windowProgress(t: number, w: Window): number {
  const enter = w.enterEnd > w.enterStart ? interpolate(t, [w.enterStart, w.enterEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const exit = w.exitEnd > w.exitStart ? interpolate(t, [w.exitStart, w.exitEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return Math.min(enter, exit);
}

function clipPathForProgress(progress: number): string | undefined {
  return progress < 1 ? `inset(0 0 ${(1 - progress) * 100}% 0)` : undefined;
}

/** How far above its resting spot "mascaraVertical" starts from — short, just enough to read as a little settle-down alongside the mask opening, not an actual slide. */
const MASCARA_VERTICAL_MOVE_PX = 18;

// letrasOla: each letter grows in from a smaller size, fades in, and settles
// out of a slight rightward offset — staggered "de derecha a izquierda" (the
// LAST character starts the wave, each one to its left follows a beat later)
// so the whole word reads as a quick ripple settling into place rather than
// popping in all at once. spring()'s own `delay` does the staggering and
// `reverse` mirrors the exact same curve for the exit (collapsing the same
// way, in reverse) — see spring()'s own semantics for why `delay` alone,
// without reverse, already means "hold at rest, then animate" on entry, and
// "hold at rest, THEN collapse" on a reversed exit.
const LETRAS_OLA_ENTER_DUR_SEC = 0.34;
const LETRAS_OLA_EXIT_DUR_SEC = 0.3;
const LETRAS_OLA_OFFSET_PX = 22;

function NivelLetrasOla({ nivel, t, fps, w }: { nivel: NivelEstilo; t: number; fps: number; w: Window }) {
  const letters = Array.from(nivel.texto);
  const n = letters.length;

  const enterDur = Math.max(0.001, w.enterEnd - w.enterStart);
  const enterLetterDur = Math.min(LETRAS_OLA_ENTER_DUR_SEC, enterDur);
  const enterStaggerSec = n > 1 ? Math.max(0, enterDur - enterLetterDur) / (n - 1) : 0;

  const exitDur = Math.max(0.001, w.exitEnd - w.exitStart);
  const exitLetterDur = Math.min(LETRAS_OLA_EXIT_DUR_SEC, exitDur);
  const exitStaggerSec = n > 1 ? Math.max(0, exitDur - exitLetterDur) / (n - 1) : 0;

  return (
    <div style={{ ...nivelFontStyle(nivel), letterSpacing: nivel.trackingPx }}>
      {letters.map((ch, i) => {
        // order 0 = rightmost letter (last in the string) = starts the wave.
        const order = n - 1 - i;

        const enterProgress = spring({
          frame: (t - w.enterStart) * fps,
          fps,
          delay: order * enterStaggerSec * fps,
          durationInFrames: Math.max(1, Math.round(enterLetterDur * fps)),
          config: { damping: 12, mass: 0.5, stiffness: 160 },
        });
        const exitProgress = spring({
          frame: (t - w.exitStart) * fps,
          fps,
          delay: order * exitStaggerSec * fps,
          durationInFrames: Math.max(1, Math.round(exitLetterDur * fps)),
          config: { damping: 14, mass: 0.5, stiffness: 160 },
          reverse: true,
        });

        const progress = Math.max(0, Math.min(1, Math.min(enterProgress, exitProgress)));
        const scale = 0.4 + 0.6 * progress;
        const translateX = (1 - progress) * LETRAS_OLA_OFFSET_PX;

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: progress,
              transform: `translateX(${translateX}px) scale(${scale})`,
              // Los signos de apertura (¿ ¡) de las fuentes script traen un avance muy ancho: se pega a la letra siguiente.
              ...(ch === "¿" || ch === "¡" ? { marginRight: "-0.32em" } : null),
            }}
          >
            {ch === " " ? " " : ch}
          </span>
        );
      })}
    </div>
  );
}

// letrasJuntan: each letter starts off past the frame's LEFT or RIGHT edge
// (whichever side of the word's middle it sits on) and slides inward to its
// resting spot, smooth (eased, not springy — that bounce is letrasOla's
// signature, not this one's). "Off past the edge" is literal: the offset is
// 60% of the frame's own width, comfortably outside what the composite ever
// shows.
//
// Letters are STAGGERED by distance from the middle rather than all moving
// at once: the outermost letter on each side starts first, and each letter
// closer in starts a little later, so the word visibly closes in on its own
// center one letter at a time instead of two rigid halves sliding in as a
// single block (which is what one shared enter/exit window for every
// letter produces — every letter on a side keeps the same fixed distance
// to its neighbors the whole way in).
//
// A quick, separate opacity fade rides alongside each letter's own
// (staggered) slide — the middle letter of an odd-length word never moves
// at all (side = 0, already "arrived"), so without its own delayed fade it
// would sit at full opacity from the very start of the level's window,
// while the outermost letters are still off-screen just beginning their
// approach. The fade is deliberately much shorter than the slide itself:
// just enough to soften that pop, not so long it reads as its own beat.
const LETRAS_JUNTAN_EASING = Easing.inOut(Easing.cubic);
const LETRAS_JUNTAN_FADE_SEC = 0.15;
// Fraction of the level's enter/exit window spent staggering letters apart
// rather than on each letter's own slide — higher reads as more "one by
// one", lower brings it back toward the old "two halves at once" look.
const LETRAS_JUNTAN_STAGGER_FRAC = 0.6;

/** Slides a shared enter/exit Window later by `orderFrac` (0 = no delay, first to move; 1 = maximum delay, last to move), shrinking its own span to match so every letter still finishes its motion inside the level's overall window. */
function staggeredWindow(w: Window, orderFrac: number): Window {
  const enterSpan = w.enterEnd - w.enterStart;
  const exitSpan = w.exitEnd - w.exitStart;
  const enterDur = enterSpan > 0 ? enterSpan * (1 - LETRAS_JUNTAN_STAGGER_FRAC) : 0;
  const exitDur = exitSpan > 0 ? exitSpan * (1 - LETRAS_JUNTAN_STAGGER_FRAC) : 0;
  const enterDelay = orderFrac * (enterSpan - enterDur);
  const exitDelay = orderFrac * (exitSpan - exitDur);
  return {
    enterStart: w.enterStart + enterDelay,
    enterEnd: w.enterStart + enterDelay + enterDur,
    exitStart: w.exitStart + exitDelay,
    exitEnd: w.exitStart + exitDelay + exitDur,
  };
}

function NivelLetrasJuntan({ nivel, t, w, width }: { nivel: NivelEstilo; t: number; w: Window; width: number }) {
  const letters = Array.from(nivel.texto);
  const n = letters.length;
  const mid = (n - 1) / 2;
  const maxDistFromMid = Math.max(mid, n - 1 - mid);
  const offscreenPx = width * 0.6;

  return (
    <div style={{ ...nivelFontStyle(nivel), letterSpacing: nivel.trackingPx, whiteSpace: "nowrap" }}>
      {letters.map((ch, i) => {
        // Letters left of center come from the left margin, letters right of
        // center from the right margin — the middle letter (odd length) just
        // stays put, already "arrived".
        const side = i < mid ? -1 : i > mid ? 1 : 0;
        const distFromMid = Math.abs(i - mid);
        // The letter(s) right at the center move first (orderFrac 0 = no
        // delay); the furthest-out letters settle in last - reads as an
        // accordion closing from the middle outward, tightening the
        // letter-spacing toward the center one pair at a time, rather than
        // the edges leading and the center trailing.
        const orderFrac = maxDistFromMid > 0 ? distFromMid / maxDistFromMid : 0;
        const lw = staggeredWindow(w, orderFrac);

        const enter =
          lw.enterEnd > lw.enterStart
            ? interpolate(t, [lw.enterStart, lw.enterEnd], [0, 1], { easing: LETRAS_JUNTAN_EASING, extrapolateLeft: "clamp", extrapolateRight: "clamp" })
            : 1;
        const exit =
          lw.exitEnd > lw.exitStart
            ? interpolate(t, [lw.exitStart, lw.exitEnd], [1, 0], { easing: LETRAS_JUNTAN_EASING, extrapolateLeft: "clamp", extrapolateRight: "clamp" })
            : 1;
        const progress = Math.min(enter, exit);
        const translateX = (1 - progress) * side * offscreenPx;

        const fadeInEnd = Math.min(lw.enterStart + LETRAS_JUNTAN_FADE_SEC, lw.enterEnd);
        const fadeIn = lw.enterEnd > lw.enterStart ? interpolate(t, [lw.enterStart, fadeInEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
        const fadeOutStart = Math.max(lw.exitEnd - LETRAS_JUNTAN_FADE_SEC, lw.exitStart);
        const fadeOut = lw.exitEnd > lw.exitStart ? interpolate(t, [fadeOutStart, lw.exitEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
        const opacity = Math.min(fadeIn, fadeOut);

        return (
          <span key={i} style={{ display: "inline-block", opacity, transform: `translateX(${translateX}px)` }}>
            {ch === " " ? " " : ch}
          </span>
        );
      })}
    </div>
  );
}

const TRES_NIVELES_KEYS = ["superior", "medio", "inferior"] as const;

function TitleLayer({
  titulo,
  t,
  fps,
  width,
  fontsVersion,
}: {
  titulo: NonNullable<OverlayProps["titulo"]>;
  t: number;
  fps: number;
  width: number;
  fontsVersion: number;
}) {
  // "tarjeta" replaces the footage for its duration rather than sitting on
  // top of it — since ffmpeg composites this whole layer over the video
  // with a plain `overlay` filter, an OPAQUE full-frame background here is
  // what makes that swap happen; "superpuesto" leaves the rest transparent
  // so the video shows through everywhere the title box doesn't cover.
  const isCard = titulo.modo === "tarjeta";
  const isTresNiveles = titulo.estilo === "tresNiveles" && titulo.tresNiveles;

  const anchoDisponible = width * titulo.anchoMaximoFrac;
  // Measured once per (text, font, width) instead of per frame — the inputs
  // don't change mid-render, and a fitted size that flickered frame to
  // frame would be far worse than one that's slightly off. `fontsVersion`
  // is in the deps so a webfont arriving late re-measures (see
  // useCustomFonts); an OS-installed font never bumps it.
  const niveles = useMemo(() => {
    const tn = titulo.tresNiveles;
    if (!tn) return undefined;
    return {
      superior: fitNivelToWidth(tn.superior, anchoDisponible),
      medio: fitNivelToWidth(tn.medio, anchoDisponible),
      inferior: fitNivelToWidth(tn.inferior, anchoDisponible),
    };
  }, [titulo.tresNiveles, anchoDisponible, fontsVersion]);

  // "tresNiveles" animates each LINE independently (staggered) further down
  // instead — putting that same animation here too would fight the stagger,
  // since every line would additionally inherit line 0's own window.
  const wholeLayerAnimation = isTresNiveles ? {} : lineAnimationStyle(t, 0, titulo);

  // posicionYFrac (precise vertical anchor) replaces `posicion`'s 3 fixed
  // flex spots entirely when set — e.g. "más abajo que el centro pero
  // dejando espacio para los subtítulos, que van independientes más abajo".
  // Absent, this is byte-for-byte the old flex layout every existing preset
  // already relies on.
  const usesCustomY = titulo.posicionYFrac !== undefined;
  const contentPositionStyle = usesCustomY
    ? {
        position: "absolute" as const,
        top: `${titulo.posicionYFrac! * 100}%`,
        left: "50%",
        transform: `translate(calc(-50% + ${titulo.bloqueDesplazamientoXPx}px), -50%)`,
      }
    : {};

  return (
    <AbsoluteFill
      style={{
        display: usesCustomY ? undefined : "flex",
        flexDirection: usesCustomY ? undefined : "column",
        justifyContent: usesCustomY ? undefined : JUSTIFY_BY_POSITION[titulo.posicion],
        alignItems: usesCustomY ? undefined : "center",
        paddingTop: !usesCustomY && titulo.posicion === "superior" ? titulo.margenSeguroPx : undefined,
        paddingBottom: !usesCustomY && titulo.posicion === "inferior" ? titulo.margenSeguroPx : undefined,
        backgroundColor: isCard ? (titulo.fondo?.activo ? titulo.fondo.color : "#000000") : undefined,
        ...wholeLayerAnimation,
      }}
    >
      {isTresNiveles ? (
        <div style={{ ...contentPositionStyle, maxWidth: width * titulo.anchoMaximoFrac, textAlign: "center", ...(isCard ? {} : backgroundCss(titulo.fondo)) }}>
          {TRES_NIVELES_KEYS.map((key, lineIndex) => {
            const nivel = niveles![key];
            if (!nivel.texto) return null;
            const w = lineWindow(lineIndex, titulo.entradaSeg, titulo.salidaSeg, titulo.duracionSeg);

            if (nivel.efecto === "letrasOla") return <NivelLetrasOla key={key} nivel={nivel} t={t} fps={fps} w={w} />;
            if (nivel.efecto === "letrasJuntan") return <NivelLetrasJuntan key={key} nivel={nivel} t={t} w={w} width={width} />;

            // "mascaraVertical" always runs the mask regardless of the
            // título's shared animacionEntrada/animacionSalida; "ninguna"
            // falls back to that shared behavior (fadeIn/fadeOut/wipeVertical
            // /ninguna), same as before this per-nivel efecto existed. The
            // mask also gets a short translateY (settles down INTO place as
            // it's revealed, retreats back up as it's masked away) — a small
            // move in the same top-to-bottom direction as the mask itself,
            // meant to read as one complementary motion rather than two.
            const { opacity, clipPath, translateY } =
              nivel.efecto === "mascaraVertical"
                ? (() => {
                    const progress = windowProgress(t, w);
                    return { opacity: 1, clipPath: clipPathForProgress(progress), translateY: (1 - progress) * -MASCARA_VERTICAL_MOVE_PX };
                  })()
                : { ...lineAnimationStyle(t, lineIndex, titulo), translateY: 0 };

            return (
              <div
                key={key}
                style={{
                  opacity,
                  clipPath,
                  transform: translateY ? `translateY(${translateY}px)` : undefined,
                  // Unlike the outer AbsoluteFill's own `fuente` (which falls
                  // back to a generic stack when unset), a level's font name
                  // is ALWAYS meaningful here — it's either an OS-installed
                  // font Chromium resolves by name with no `archivo` at all
                  // (this composition runs in a real local Chromium, so
                  // whatever's installed on this machine is visible to it
                  // exactly like any GUI browser), or a webfont useCustomFonts
                  // already registered under this same familia.
                  ...nivelFontStyle(nivel),
                  letterSpacing: nivel.trackingPx,
                }}
              >
                {nivel.texto}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            ...contentPositionStyle,
            maxWidth: width * titulo.anchoMaximoFrac,
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
      )}
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

type SubtitleWord = OverlayProps["subtitulos"][number]["words"][number];

/**
 * Greedy width-pack (canvas-measured, so it matches the actual rendered
 * font exactly — a character-count heuristic like wrapWordsIntoLines
 * doesn't, especially once a pill's own paddingX adds real pixels per
 * word) into lines that never exceed maxWidthPx. Unlike wrapWordsIntoLines
 * this never stops at a fixed number of lines — the caller always gets
 * back however many one-line chunks the whole word list needs.
 */
function packWordsByWidth(
  words: readonly SubtitleWord[],
  fuente: FontSpec,
  fontSize: number,
  maxWidthPx: number,
  extraPerWordPx: number,
  spaceWidthPx: number,
): SubtitleWord[][] {
  const lines: SubtitleWord[][] = [];
  let current: SubtitleWord[] = [];
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = measureTextPx(word.text, fontSize, fuente, 0) + extraPerWordPx;
    const addedWidth = current.length === 0 ? wordWidth : currentWidth + spaceWidthPx + wordWidth;
    if (addedWidth > maxWidthPx && current.length > 0) {
      lines.push(current);
      current = [word];
      currentWidth = wordWidth;
    } else {
      current.push(word);
      currentWidth = addedWidth;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** A packed line's own visible window — see packFluidLines below for why line N+1's window never leaves a gap after line N's. */
interface FluidLine {
  words: readonly SubtitleWord[];
  startSec: number;
  endSec: number;
}

/**
 * `lineaUnicaFluida`'s line-building: pack by real width (never 2 lines at
 * once), then make every line's window butt up against the next one's —
 * line N stays on screen until line N+1's first word actually starts,
 * instead of just until line N's own last word ends. That's what keeps a
 * mid-sentence pause from reading as the subtitle vanishing: the last
 * thing said stays up until there's something new to replace it with.
 */
function packFluidLines(
  words: readonly SubtitleWord[],
  blockEndSec: number,
  fuente: FontSpec,
  fontSize: number,
  maxWidthPx: number,
  extraPerWordPx: number,
  spaceWidthPx: number,
): FluidLine[] {
  const packed = packWordsByWidth(words, fuente, fontSize, maxWidthPx, extraPerWordPx, spaceWidthPx);
  return packed.map((lineWords, i) => ({
    words: lineWords,
    startSec: lineWords[0]!.startSec,
    endSec: i + 1 < packed.length ? packed[i + 1]![0]!.startSec : blockEndSec,
  }));
}

function SubtitleLayer({
  block,
  estilo,
  t,
  width,
  fuente,
}: {
  block: OverlayProps["subtitulos"][number];
  estilo: OverlayProps["subtituloEstilo"];
  t: number;
  width: number;
  fuente: FontSpec;
}) {
  const textShadow = textShadowCss(estilo.sombra);
  const pill = estilo.fondoPalabraActiva?.activo ? estilo.fondoPalabraActiva : undefined;
  const effectiveFuente = estilo.fuente ?? fuente;

  // Time-independent (doesn't depend on `t`), so this only needs to
  // recompute when the words/config actually change, not every frame.
  const fluidLines = useMemo(() => {
    if (!estilo.lineaUnicaFluida) return null;
    // A fixed safety margin off each side — same role as título's own
    // anchoMaximoFrac, just not (yet) its own preset knob here.
    const maxWidthPx = width * 0.82;
    const extraPerWordPx = pill ? pill.paddingX * 2 : 0;
    const spaceWidthPx = pill ? 0 : measureTextPx(" ", estilo.tamano, effectiveFuente, 0) || estilo.tamano * 0.28;
    return packFluidLines(block.words, block.endSec, effectiveFuente, estilo.tamano, maxWidthPx, extraPerWordPx, spaceWidthPx);
    // effectiveFuente is a fresh object every render; its own content
    // (familia/peso) is what actually affects the measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estilo.lineaUnicaFluida, block.words, block.endSec, width, estilo.tamano, effectiveFuente.familia, effectiveFuente.peso, pill?.paddingX]);

  const activeWords = fluidLines ? (fluidLines.find((l) => t >= l.startSec && t < l.endSec) ?? fluidLines.at(-1))?.words : undefined;
  if (fluidLines && !activeWords) return null;
  const lines = activeWords ? [activeWords] : wrapWordsIntoLines(block.words, estilo.maxCaracteresPorLinea, estilo.maxLineas);

  // Fluid mode highlights exactly one word at all times, never none: the
  // pill would otherwise go dark for the (real, if brief) gap between one
  // word's own endSec and the next word's startSec — confirmed distracting
  // on a real render, reading as the highlight "blinking off" between every
  // word instead of sliding across them. Same fix as packFluidLines' own
  // line-to-line bridging, one level down: the LAST word that has already
  // started (by startSec, ignoring its own endSec) stays lit until the next
  // one starts.
  let fluidActiveIndex = -1;
  if (activeWords) {
    for (let i = 0; i < activeWords.length; i++) {
      if (activeWords[i]!.startSec <= t) fluidActiveIndex = i;
    }
  }

  const animation = estilo.animacion === "pop" ? 1 : 0;
  const sinceBlockStart = Math.max(0, t - block.startSec);
  // spring() takes a frame count, not seconds — 30fps is a safe assumption
  // for the pop-in's timing feel even at a different output fps, since it
  // only affects how many frames the spring interpolates over, not the
  // wall-clock duration much (spring is frame-rate-aware internally).
  const popScale = animation ? spring({ frame: Math.round(sinceBlockStart * 30), fps: 30, config: { damping: 12, stiffness: 200 } }) : 1;

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
        // Unlike the outer AbsoluteFill's own `fuente` (gated on `archivo`
        // to avoid naming a webfont that might still be mid-download), this
        // applies unconditionally — same as a "tresNiveles" nivel's own
        // fuente.familia — since a system font (no `archivo` at all, e.g.
        // "Georgia") needs no load-wait and would otherwise never actually
        // get requested.
        fontFamily: estilo.fuente?.familia,
      }}
    >
      <div style={{ textAlign: "center", ...backgroundCss(estilo.fondo) }}>
        {lines.map((line, lineIndex) => (
          <div key={lineIndex} style={{ whiteSpace: "nowrap" }}>
            {line.map((word, wordIndex) => {
              const isActive =
                estilo.resaltarPalabraActiva && (activeWords ? wordIndex === fluidActiveIndex : t >= word.startSec && t < word.endSec);
              const showPill = isActive && pill !== undefined;
              return (
                <span
                  key={wordIndex}
                  style={{
                    fontSize: estilo.tamano,
                    fontWeight: 700,
                    textTransform: estilo.mayusculas ? "uppercase" : "none",
                    color: showPill ? pill.colorTexto : isActive ? estilo.colorPalabraActiva : estilo.color,
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
                    WebkitTextFillColor: showPill ? pill.colorTexto : isActive ? estilo.colorPalabraActiva : estilo.color,
                    textShadow: showPill ? undefined : textShadow || undefined,
                    // Every word gets the SAME padding/radius all the time
                    // (pill mode only), whether or not it's active right
                    // now — only backgroundColor flips between transparent
                    // and the pill's color. A box-shadow was tried first to
                    // avoid reserving space at all, but rendered as a thin
                    // ring instead of a solid fill on a real transparent-alpha
                    // render (confirmed). Applying padding to ONLY the
                    // active word was tried before that and rejected too: it
                    // grows that one word's own box the instant it
                    // activates, shifting it down off the shared baseline —
                    // also confirmed on a real render. Reserving the same
                    // space on every word, always, is what keeps size,
                    // position and line-height identical across the whole
                    // line regardless of which word is active.
                    backgroundColor: pill ? (showPill ? pill.color : "transparent") : undefined,
                    borderRadius: pill ? pill.radio : undefined,
                    padding: pill ? `${pill.paddingY}px ${pill.paddingX}px` : undefined,
                  }}
                >
                  {word.text}
                  {!pill && wordIndex < line.length - 1 ? " " : ""}
                </span>
              );
            })}
          </div>
        ))}
            </div>
    </AbsoluteFill>
  );
}
