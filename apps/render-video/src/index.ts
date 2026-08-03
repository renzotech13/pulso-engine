// Deliberately does NOT re-export renderLocal (./render) — that module pulls
// in @remotion/bundler, which spins up its own rspack build with native
// binaries. A Next.js route handler that imports this barrel must never
// drag that in just to reach the registry/schema metadata below; the actual
// render only ever runs out-of-process, invoked as `./cli.ts` via tsx (see
// render-templates/src/lib/remotion-cli.ts).
export { REMOTION_REGISTRY, isKnownRemotionRef, type RemotionCompositionRef } from "./registry";
