import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { RemotionCompositionRef } from "./registry";

// "local" is the only render target implemented today — renders happen in
// this same process/machine. A "lambda" target (submit to Remotion Lambda,
// await the result) is the documented next step for when a single machine
// stops being enough, not built until that's actually needed.
export type RenderTarget = "local";

let bundlePromise: Promise<string> | undefined;

// Bundling is the slow part (webpack build of the whole Root); do it once
// per process and reuse the served location for every render after —
// same reasoning as the shared Puppeteer browser in render-templates.
function getBundleLocation(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: path.join(import.meta.dirname, "entry.ts") });
  }
  return bundlePromise;
}

export async function renderLocal(
  compositionId: RemotionCompositionRef,
  inputProps: Record<string, unknown>,
): Promise<Buffer> {
  const serveUrl = await getBundleLocation();

  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
  });

  const outputDir = await mkdtemp(path.join(tmpdir(), "pulso-render-"));
  const outputLocation = path.join(outputDir, `${randomUUID()}.mp4`);

  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
    });

    return await readFile(outputLocation);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}
