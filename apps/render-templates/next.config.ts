import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  // Puppeteer screenshots these pages verbatim to produce the final creative
  // PNG — Next's dev-mode indicator badge (bottom-left) would otherwise get
  // baked into every real published image.
  devIndicators: false,
  // @pulso/render-video's relative imports write an explicit ".js" extension
  // (the NodeNext convention @pulso/video-editor's tsc config requires of
  // anything it transitively imports) — webpack has no built-in ".js"
  // resolves-to-".tsx"/".ts" mapping the way tsc's NodeNext resolution does,
  // so left alone this app's build 404s on e.g. "./compositions/overlay.schema.js".
  // Same fix already applied to Remotion's own bundler in render-video's
  // render.ts, needed here too since this is a SEPARATE webpack build.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
