import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { RemotionCompositionRef } from "./registry.js";

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
    bundlePromise = bundle({
      entryPoint: path.join(import.meta.dirname!, "entry.ts"),
      // Every relative import in this package now writes an explicit ".js"
      // extension, per the NodeNext convention @pulso/video-editor's tsc
      // config requires of anything it transitively imports (this package's
      // render.ts/registry.ts are two such files). Webpack has no built-in
      // ".js"-resolves-to-".tsx" mapping the way tsc's NodeNext resolution
      // does, so left alone it 404s on e.g. "./Root.js" — extensionAlias
      // teaches it the same mapping, which keeps the extensions consistent
      // everywhere instead of some files needing them and others not.
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
        },
      }),
    });
  }
  return bundlePromise;
}

export interface RenderLocalOptions {
  /**
   * "h264" (default) for a normal opaque render. "prores-4444" for a
   * transparent-background render — video-editor's subtitle/title overlay
   * needs an alpha channel so ffmpeg can composite it over real footage
   * afterward; nothing else in the repo needs alpha today.
   */
  codec?: "h264" | "prores-4444";
}

export async function renderLocal(
  compositionId: RemotionCompositionRef,
  inputProps: Record<string, unknown>,
  options: RenderLocalOptions = {},
): Promise<Buffer> {
  const serveUrl = await getBundleLocation();

  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
  });

  const outputDir = await mkdtemp(path.join(tmpdir(), "pulso-render-"));
  const extension = options.codec === "prores-4444" ? "mov" : "mp4";
  const outputLocation = path.join(outputDir, `${randomUUID()}.${extension}`);

  try {
    await renderMedia({
      composition,
      serveUrl,
      ...(options.codec === "prores-4444"
        ? {
            codec: "prores" as const,
            proResProfile: "4444" as const,
            // Neither of these is implied by codec+profile alone — both are
            // needed for the output to actually carry an alpha channel
            // (confirmed empirically: without them ffprobe reports
            // yuv422p12le, opaque, regardless of proResProfile "4444"):
            //  - imageFormat "png" makes Remotion omit Puppeteer's own
            //    background when it screenshots each frame (see
            //    take-frame.js: `omitBackground: imageFormat === 'png'`);
            //  - pixelFormat "yuva444p10le" is the actual alpha-carrying
            //    pixel format ffmpeg is told to encode into.
            imageFormat: "png" as const,
            pixelFormat: "yuva444p10le" as const,
          }
        : { codec: "h264" as const }),
      outputLocation,
      inputProps,
    });

    return await readFile(outputLocation);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}
