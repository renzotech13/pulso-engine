// Builds real (not mocked) test material for the end-to-end pipeline test:
// an actual spoken-word video, a script PDF matching what was said, and a
// short music bed — generated fresh into a temp dir instead of checking in
// binary fixtures, so nothing here goes stale or bloats the repo.
//
// Speech comes from macOS's `say` (real synthesized speech, not a tone) so
// whisper-cli has something genuine to transcribe — this is why the
// end-to-end test can only run on a machine with `say` on the PATH, same as
// it can only run with ffmpeg and whisper-cli present.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const FIXTURE_SCRIPT_TEXT =
  "Hoy te explico como sacar tu ruc en sunarp paso a paso. Formalizarte cuesta menos que una multa.";
export const FIXTURE_TITLE = "Formaliza tu negocio hoy";

export interface Fixtures {
  videoPath: string;
  pdfPath: string;
  musicPath: string;
}

async function commandExists(binary: string): Promise<boolean> {
  try {
    await run("/usr/bin/which", [binary]);
    return true;
  } catch {
    return false;
  }
}

/** Everything the e2e test needs on top of ffmpeg (checked separately by the pipeline itself). */
export async function checkE2ePrerequisites(): Promise<string | undefined> {
  if (process.platform !== "darwin") return "el generador de material de prueba usa `say`, solo disponible en macOS";
  if (!(await commandExists("say"))) return "el comando `say` no está disponible";
  if (!(await commandExists("ffmpeg"))) return "ffmpeg no está disponible";
  if (!(await commandExists("whisper-cli"))) return "whisper-cli no está disponible (brew install whisper-cpp)";
  if (!(await commandExists("cupsfilter"))) return "cupsfilter no está disponible";
  if (!process.env.WHISPER_MODEL_PATH) return "WHISPER_MODEL_PATH no está configurado";
  return undefined;
}

async function synthesizeSpeech(text: string, outWavPath: string): Promise<void> {
  const aiffPath = outWavPath.replace(/\.wav$/, ".aiff");
  await run("say", ["-v", "Monica", "-o", aiffPath, text]);
  await run("ffmpeg", ["-y", "-i", aiffPath, "-ar", "44100", "-ac", "1", outWavPath]);
}

/**
 * A vertical test-pattern video with the synthesized speech as its audio
 * track — real audio a real whisper.cpp run has to actually transcribe, not
 * a silent or tone-only clip.
 */
async function buildVideo(speechWavPath: string, outMp4Path: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc2=size=1080x1920:rate=30",
    "-i", speechWavPath,
    "-shortest",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    outMp4Path,
  ]);
}

async function buildMusic(outMp3Path: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=220:duration=8",
    "-c:a", "libmp3lame",
    outMp3Path,
  ]);
}

/**
 * `cupsfilter` (macOS's built-in text-to-PDF filter, part of CUPS) rather
 * than a PDF-writing library: a real library (pdfkit) was tried first and
 * produces PDFs the pipeline's own pdf-parse dependency can't read back
 * ("bad XRef entry" — pdf-parse bundles a years-old pdf.js that chokes on
 * pdfkit's xref table) — confirmed by hand, not a guess. `cupsfilter`
 * matches exactly how every other PDF fixture used against this pipeline in
 * manual testing was produced, and needs no extra dependency.
 */
async function buildScriptPdf(outPdfPath: string): Promise<void> {
  const txtPath = outPdfPath.replace(/\.pdf$/, ".txt");
  await writeFile(txtPath, `Video 1\nTítulo: ${FIXTURE_TITLE}\n${FIXTURE_SCRIPT_TEXT}\n`, "utf8");
  const { stdout } = await run("cupsfilter", [txtPath], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  await writeFile(outPdfPath, stdout);
}

export async function generateFixtures(dir: string): Promise<Fixtures> {
  await mkdir(dir, { recursive: true });
  const speechWavPath = path.join(dir, "speech.wav");
  const videoPath = path.join(dir, "clip1.mp4");
  const musicPath = path.join(dir, "music.mp3");
  const pdfPath = path.join(dir, "guion.pdf");

  await synthesizeSpeech(FIXTURE_SCRIPT_TEXT, speechWavPath);
  await Promise.all([buildVideo(speechWavPath, videoPath), buildMusic(musicPath), buildScriptPdf(pdfPath)]);

  return { videoPath, pdfPath, musicPath };
}
