import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Without this, Next.js infers the workspace root from the nearest
  // lockfile and picks up the unrelated one in the user's home directory.
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
};

export default nextConfig;
