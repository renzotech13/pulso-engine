import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  // Puppeteer screenshots these pages verbatim to produce the final creative
  // PNG — Next's dev-mode indicator badge (bottom-left) would otherwise get
  // baked into every real published image.
  devIndicators: false,
};

export default nextConfig;
