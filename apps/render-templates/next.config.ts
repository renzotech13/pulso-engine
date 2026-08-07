import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  // Puppeteer screenshots these pages verbatim to produce the final creative
  // PNG — Next's dev-mode indicator badge (bottom-left) would otherwise get
  // baked into every real published image.
  devIndicators: false,
  // renderRemotionComposition (lib/remotion-video.ts) reaches
  // apps/render-video/src/render.ts (and its @remotion/bundler,
  // @remotion/renderer deps) only by spawning `npx tsx cli.ts` as a
  // subprocess at runtime — Next's static tracing can't see that dynamic
  // spawn, so it silently drops those files from the deployed function,
  // 'Cannot find package "@remotion/bundler"' on Vercel even though the
  // build succeeds. This gets some of it in (confirmed: Next's tracer does
  // NOT follow pnpm's node_modules symlinks into the real .pnpm store, so
  // @remotion/bundler/@remotion/renderer themselves still don't make it —
  // still 500s in production as of this commit). Left in as a real partial
  // improvement, not a full fix; see apps/render-video/src/render-once.ts
  // for the actual working path (render locally, upload directly) used
  // until this gets a proper fix (Remotion Lambda, or a persistent host
  // for this one step — a stock Vercel serverless function may just not be
  // a good fit here at all, given Remotion's own headless Chromium alone
  // is ~190MB, close to the function size ceiling by itself).
  outputFileTracingIncludes: {
    "/api/render/[creativeId]": ["../render-video/**"],
  },
};

export default nextConfig;
