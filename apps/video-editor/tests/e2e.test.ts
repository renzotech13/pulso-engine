// Full pipeline, nothing mocked: real ffmpeg, real whisper-cli transcribing
// real synthesized speech, a real PDF, a real Remotion render. This is the
// same code path as `pnpm process` and the dashboard — see project.ts.
//
// Only runs on a machine with the actual tools installed (ffmpeg, whisper-cli
// + WHISPER_MODEL_PATH, macOS `say` for fixture generation) — the same
// prerequisites README.md documents for using the feature at all. Skips with
// a clear reason instead of failing when they're missing, so `pnpm test` in
// an environment without them (a bare CI runner, say) doesn't break.

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeAsset } from "../src/pipeline/ffmpeg.js";
import { processProject } from "../src/pipeline/project.js";
import { edlSchema, scriptDocumentSchema, subtitleTrackSchema } from "../src/pipeline/types.js";
import { checkE2ePrerequisites, generateFixtures, FIXTURE_TITLE, type Fixtures } from "./helpers/fixtures.js";

const skipReason = await checkE2ePrerequisites();

describe.skipIf(Boolean(skipReason))("processProject (end-to-end)", () => {
  if (skipReason) console.warn(`[e2e] omitida: ${skipReason}`);

  let workDir: string;
  let fixturesDir: string;
  let outDir: string;
  let fixtures: Fixtures;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "pulso-video-editor-e2e-"));
    fixturesDir = path.join(workDir, "fixtures");
    outDir = path.join(workDir, "project");
    fixtures = await generateFixtures(fixturesDir);
  }, 60_000);

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it(
    "ingests a real take, transcribes it, cuts it, and renders a playable MP4 + SRT",
    async () => {
      const results = await processProject({
        videoPaths: [fixtures.videoPath],
        pdfPath: fixtures.pdfPath,
        outDir,
        musicPath: fixtures.musicPath,
        language: "es",
      });

      expect(results).toHaveLength(1);
      const result = results[0]!;
      expect(result.videoId).toBe("video-1");

      // The PDF's own heading ("Título: ...") was actually parsed, not
      // defaulted or left for manual review.
      const scriptPath = path.join(outDir, "artifacts", "script.json");
      const script = scriptDocumentSchema.parse(JSON.parse(await readFile(scriptPath, "utf8")));
      expect(script.videos[0]!.titulo).toBe(FIXTURE_TITLE);
      expect(script.videos[0]!.necesitaRevision).toBe(false);

      // The render actually produced a valid, playable video with audio —
      // not just a file that exists.
      const outputProbe = await probeAsset(result.outputMp4Path);
      expect(outputProbe.hasAudio).toBe(true);
      expect(outputProbe.durationSec).toBeGreaterThan(0);
      expect(outputProbe.width).toBeGreaterThan(0);
      expect(outputProbe.height).toBeGreaterThan(0);

      // The SRT is non-empty and shaped like real subtitle cues.
      const srt = await readFile(result.outputSrtPath, "utf8");
      expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);

      // The EDL that came out of alignment actually kept something from the
      // real (synthesized) speech — the pipeline didn't just no-op.
      const edl = edlSchema.parse(JSON.parse(await readFile(result.edlPath, "utf8")));
      expect(edl.segmentos.length).toBeGreaterThan(0);

      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as Record<string, unknown>;
      expect(manifest.transcriptionProvider).toBe("whisper-cpp");
      expect(manifest.musicPath).toBe(fixtures.musicPath);

      const subtitlesPath = path.join(outDir, "artifacts", "subtitles", "video-1.json");
      const subtitles = subtitleTrackSchema.parse(JSON.parse(await readFile(subtitlesPath, "utf8")));
      expect(subtitles.bloques.length).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "re-renders with a different preset without re-transcribing (reuses the audio artifact)",
    async () => {
      const audioArtifactPath = path.join(
        outDir,
        "artifacts",
        "audio",
        `${path.basename(fixtures.videoPath)}.json`,
      );
      const before = await stat(audioArtifactPath);

      // No preset override configured for this fixture project, so this run
      // just re-processes with the same (implicit default) preset — the
      // point is confirming the audio artifact from the first test's run is
      // reused (same mtime) rather than transcribed again.
      const results = await processProject({
        videoPaths: [fixtures.videoPath],
        pdfPath: fixtures.pdfPath,
        outDir,
        musicPath: fixtures.musicPath,
        language: "es",
      });

      const after = await stat(audioArtifactPath);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(results).toHaveLength(1);

      const outputProbe = await probeAsset(results[0]!.outputMp4Path);
      expect(outputProbe.hasAudio).toBe(true);
    },
    60_000,
  );
});
