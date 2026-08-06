import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Without this, Next.js infers the workspace root from the nearest
  // lockfile and picks up the unrelated one in the user's home directory.
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  // @pulso/shared ships raw .ts source (no build step) with relative
  // imports like "./logger.js" pointing at "./logger.ts" — tsc resolves
  // that fine, but Next's own bundler only does when the package is listed
  // here. First surfaced when actions.ts started importing
  // @pulso/shared/image-gen (nothing in apps/web touched @pulso/shared
  // before that): "Module not found: Can't resolve './logger.js'".
  transpilePackages: ["@pulso/shared"],
  experimental: {
    // Default is 1MB — "Publicar con marco" submits a whole batch of real
    // photos (e.g. 18 match photos at ~1-2MB each) as one multipart Server
    // Action request, which blows past that immediately.
    serverActions: {
      bodySizeLimit: "50mb",
    },
    // Separate from the above: middleware.ts runs on every request (session
    // refresh) and Next.js buffers the whole request body to replay it past
    // middleware, capped at 10MB by default — silently truncating anything
    // past that, which corrupts the multipart body and surfaces downstream
    // as "Unexpected end of form" well before serverActions' own limit is
    // ever reached. Raised to match.
    middlewareClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
