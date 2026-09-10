import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { SubtitleOverlayProps } from "./subtitle-overlay.schema.js";

export { subtitleOverlaySchema, type SubtitleOverlayProps } from "./subtitle-overlay.schema.js";

/**
 * Fase 1 of the video editor: plain, unstyled subtitles — just proving the
 * whole pipeline (ingest → script → transcribe → align → EDL → overlay →
 * ffmpeg composite) produces a correct video end to end. The brand preset
 * (font, karaoke highlight, background box, position, animations — see the
 * ticket's section 3) replaces the hardcoded styles below in Fase 2.
 *
 * Renders on a transparent background on purpose: video-editor's render.ts
 * asks for this with an alpha-capable codec (ProRes 4444) and composites it
 * over the concatenated footage with ffmpeg's `overlay` filter — Remotion
 * only ever draws the graphics layer here, never the source video (see the
 * Fase 0 writeup on why ffmpeg, not Remotion, owns concatenation/encoding).
 */
export function SubtitleOverlay({ bloques }: SubtitleOverlayProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  const active = bloques.find((b) => currentSec >= b.startSec && currentSec < b.endSec);

  return (
    <AbsoluteFill>
      {active && (
        <div
          style={{
            position: "absolute",
            left: 48,
            right: 48,
            bottom: 160,
            textAlign: "center",
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontSize: 52,
            fontWeight: 700,
            color: "#FFFFFF",
            textShadow: "0 2px 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.85)",
            lineHeight: 1.2,
          }}
        >
          {active.text}
        </div>
      )}
    </AbsoluteFill>
  );
}
