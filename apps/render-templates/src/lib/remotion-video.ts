import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RemotionCompositionRef } from "@pulso/render-video";

const execFileAsync = promisify(execFile);

// process.cwd() is this app's root (apps/render-templates) for both `next
// dev` and `next start` — apps/render-video is its fixed sibling (same
// assumption next.config.ts makes for outputFileTracingRoot). Not resolved
// via import.meta.resolve/dirname: those get rewritten by webpack's RSC
// bundling to point at .next's compiled output location, not the source tree.
const RENDER_VIDEO_PKG_DIR = path.resolve(process.cwd(), "../render-video");

/**
 * @remotion/bundler runs its own rspack build with native binaries — importing
 * it directly here would make Next try to webpack-bundle Remotion's own
 * bundler, which crashes at parse time. Rendering in a `tsx` subprocess
 * (apps/render-video/src/cli.ts) keeps that entirely out of Next's build.
 */
export async function renderRemotionComposition(
  compositionId: RemotionCompositionRef,
  props: Record<string, unknown>,
): Promise<Buffer> {
  const cliPath = path.join(RENDER_VIDEO_PKG_DIR, "src/cli.ts");

  const outputDir = await mkdtemp(path.join(tmpdir(), "pulso-video-"));
  const outputPath = path.join(outputDir, "output.mp4");

  try {
    // On Vercel's serverless runtime, $HOME points at a directory that
    // doesn't exist — npx (even to run an already-installed local package)
    // still tries to create its cache/log dir under $HOME/.npm before doing
    // anything else, so it fails with ENOENT before ever reaching tsx. /tmp
    // is the only writable path in that environment; redirecting HOME there
    // gives npm somewhere real to write. Harmless locally too, since tsx is
    // already in node_modules and this never touches the network either way.
    await execFileAsync("npx", ["--yes", "tsx", cliPath, compositionId, JSON.stringify(props), outputPath], {
      cwd: RENDER_VIDEO_PKG_DIR,
      maxBuffer: 1024 * 1024 * 50,
      env: { ...process.env, HOME: outputDir },
    });
    return await readFile(outputPath);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}
