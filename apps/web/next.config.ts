import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Without this, Next.js infers the workspace root from the nearest
  // lockfile and picks up the unrelated one in the user's home directory.
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  // These ship raw .ts source (no build step) — Next's bundler only picks
  // them up for transpilation when listed here. (Their own internal cross-
  // file imports were separately rewritten from relative "./x.js" paths to
  // self-referencing package-subpath imports, e.g. "@pulso/events/catalog"
  // — transpilePackages alone doesn't make webpack resolve a ".js"
  // extension pointing at an unbuilt ".ts" file. See @pulso/shared/image-gen
  // and @pulso/publish/agent for where this first bit.)
  transpilePackages: ["@pulso/shared", "@pulso/db", "@pulso/events", "@pulso/publish"],
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
