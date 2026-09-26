// Standalone render for the one-off Movistar price card — same
// bundle+selectComposition+renderMedia recipe as render.ts's renderLocal,
// but pointed at precio-card-entry.ts instead of the shared entry.ts/
// Root.tsx, so it never touches the multi-tenant registry other brands rely
// on. Invoked directly with tsx, not through cli.ts.
//
// uso: tsx src/precio-card-cli.ts <propsJson> <outputPath.mov> [compositionId]
//      compositionId: "precio-card" (default) o "feature-cards"
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

async function main() {
  const [, , propsJson, outputPath, compositionArg] = process.argv;
  if (!propsJson || !outputPath) {
    throw new Error("uso: tsx src/precio-card-cli.ts <propsJson> <outputPath.mov> [compositionId]");
  }
  const compositionId = compositionArg ?? "precio-card";
  const inputProps = JSON.parse(propsJson) as Record<string, unknown>;

  const serveUrl = await bundle({
    entryPoint: path.join(import.meta.dirname!, "precio-card-entry.ts"),
    webpackOverride: (config) => ({
      ...config,
      resolve: { ...config.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"] } },
    }),
  });

  const composition = await selectComposition({ serveUrl, id: compositionId, inputProps });

  await renderMedia({
    composition,
    serveUrl,
    onBrowserLog: (log) => console.log(`[remotion:${log.type}] ${log.text}`),
    codec: "prores" as const,
    proResProfile: "4444" as const,
    imageFormat: "png" as const,
    pixelFormat: "yuva444p10le" as const,
    outputLocation: path.resolve(outputPath),
    inputProps,
  });

  console.log(`listo: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
