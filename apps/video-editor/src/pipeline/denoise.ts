// 2.7b (optional, between concatenateSegments and mixAudio): runs the voice
// track through DeepFilterNet (`deep-filter`), a real-time speech
// enhancement model — much closer to "sounds like it was recorded in a
// studio" than ffmpeg's own noise filters (afftdn/arnndn). Ships as a native
// Rust binary with its model weights baked in, so this shells out to it the
// same way transcription.ts shells out to whisper-cli — no Python/PyTorch
// dependency.

import { copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AppError } from "@pulso/shared/errors";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export class DenoiseError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "DENOISE_ERROR", cause);
    this.name = "DenoiseError";
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

/**
 * Runs `inputWavPath` through `deep-filter`, writing the cleaned audio to
 * `outputWavPath`. The binary always writes into a directory (`-o`) using
 * the input's own basename — a scratch dir plus a copy is what turns that
 * into "write to exactly this path."
 */
export async function denoiseAudio(
  inputWavPath: string,
  outputWavPath: string,
  binaryPath = "deep-filter",
): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "pulso-deepfilter-"));
  try {
    try {
      await run(binaryPath, [inputWavPath, "-o", workDir], { maxBuffer: MAX_BUFFER });
    } catch (err) {
      if (isEnoent(err)) {
        throw new DenoiseError(
          `no se encontró el binario "${binaryPath}". Configurá DEEP_FILTER_BIN_PATH apuntando al binario de DeepFilterNet ` +
            "(https://github.com/Rikorose/DeepFilterNet/releases).",
          err,
        );
      }
      throw new DenoiseError(`deep-filter falló limpiando "${inputWavPath}"`, err);
    }

    const [outputName] = await readdir(workDir);
    if (!outputName) {
      throw new DenoiseError(`deep-filter no generó ningún archivo de salida para "${inputWavPath}"`);
    }
    await copyFile(path.join(workDir, outputName), outputWavPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
