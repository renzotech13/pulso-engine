// Focused regression test for the "tresNiveles" título template: proves the
// two independently-maintained schemas (video-editor's preset.ts and
// render-video's overlay.schema.ts — deliberately not shared, see
// overlay.schema.ts's own comment on why) actually agree end-to-end by doing
// a REAL Remotion render, not just a type-check. A mismatch between the two
// only ever surfaces at render time (a zod parse throwing deep inside
// Chromium), never at `tsc --noEmit`.
//
// Deliberately doesn't go through processProject/transcription — an EDL and
// SubtitleTrack are built by hand so this only needs ffmpeg (to synthesize a
// throwaway source clip) and a real Remotion render, not whisper-cli/`say`.

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { probeAsset } from "../src/pipeline/ffmpeg.js";
import { loadDefaultPreset } from "../src/pipeline/preset.js";
import { renderProject } from "../src/pipeline/render.js";
import type { Edl, ScriptVideo, SubtitleTrack } from "../src/pipeline/types.js";

const run = promisify(execFile);

async function commandExists(binary: string): Promise<boolean> {
  try {
    await run("/usr/bin/which", [binary]);
    return true;
  } catch {
    return false;
  }
}

const skipReason = (await commandExists("ffmpeg")) ? undefined : "ffmpeg no está disponible";

describe.skipIf(Boolean(skipReason))("renderProject — título tresNiveles", () => {
  if (skipReason) console.warn(`[render-tres-niveles] omitida: ${skipReason}`);

  it(
    "renderiza un título de 3 niveles con máscara de entrada y de salida sin lanzar, y produce un video reproducible",
    async () => {
      const workDir = await mkdtemp(path.join(tmpdir(), "pulso-tres-niveles-"));
      try {
        const sourcePath = path.join(workDir, "source.mp4");
        await run("ffmpeg", [
          "-y",
          "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=3",
          "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
          "-shortest",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          sourcePath,
        ]);

        const preset = await loadDefaultPreset();
        preset.titulo = {
          ...preset.titulo,
          estilo: "tresNiveles",
          duracionSeg: 2,
          entradaSeg: 0.3,
          salidaSeg: 0.3,
          animacionEntrada: "wipeVertical",
          animacionSalida: "wipeVertical",
          tresNiveles: {
            superior: { fuente: { familia: "Georgia", peso: 400 }, tamano: 70, color: "#FFFFFF", efecto: "letrasOla" },
            medio: { fuente: { familia: "Arial", peso: 800 }, tamano: 110, color: "#FADADD", efecto: "letrasJuntan" },
            inferior: {
              fuente: { familia: "Arial", peso: 600 },
              tamano: 32,
              color: "#FFFFFF",
              trackingPx: 6,
              mayusculas: true,
              efecto: "mascaraVertical",
            },
          },
        };

        const scriptVideo: ScriptVideo = {
          id: "video-1",
          titulo: "Blanco Rosa | ROSA | palo",
          mostrarTitulo: true,
          guion: "",
          carpetaTomas: null,
          escenas: [],
          necesitaRevision: false,
        };

        const edl: Edl = {
          videoId: "video-1",
          segmentos: [{ archivo: sourcePath, inicio: 0, fin: 2.9, lineaGuion: "", videoId: "video-1" }],
        };

        const subtitleTrack: SubtitleTrack = { videoId: "video-1", bloques: [] };

        const outputPath = path.join(workDir, "output.mp4");
        const result = await renderProject(
          edl,
          scriptVideo,
          subtitleTrack,
          preset,
          { width: 1080, height: 1920, fps: 30, crf: 20 },
          outputPath,
        );

        const probe = await probeAsset(result.outputMp4Path);
        expect(probe.hasAudio).toBe(true);
        expect(probe.durationSec).toBeGreaterThan(0);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
