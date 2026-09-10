#!/usr/bin/env tsx
// Fase 1's "ejecutable desde un comando interno o script" — no UI, no DB,
// just files in and files out. Fase 3 wraps this same `processProject` call
// behind the async job/queue infra; the pipeline itself doesn't change.
//
// Usage:
//   pnpm --filter @pulso/video-editor process \
//     --videos clip1.mp4,clip2.mp4 --pdf guiones.pdf --out ./tmp/proyecto-1
//
// Or point --videos-dir at a folder and every *.mp4 directly inside it is used.

import path from "node:path";
import { createLogger } from "@pulso/shared/logger";
import { listMp4sInDir, processProject } from "./pipeline/project.js";

const logger = createLogger({ agent: "video-editor-cli" });

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        args[key] = value;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pdf || !args.out || (!args.videos && !args["videos-dir"])) {
    console.error(
      "uso: tsx src/cli.ts --videos a.mp4,b.mp4 --pdf guion.pdf --out ./salida [--videos-dir carpeta] [--force] [--language es]",
    );
    process.exit(1);
  }

  const videoPaths = args["videos-dir"]
    ? await listMp4sInDir(path.resolve(args["videos-dir"]))
    : args.videos!.split(",").map((p) => path.resolve(p.trim()));

  if (videoPaths.length === 0) {
    console.error("no se encontró ningún .mp4 para procesar");
    process.exit(1);
  }

  const results = await processProject({
    videoPaths,
    pdfPath: path.resolve(args.pdf!),
    outDir: path.resolve(args.out!),
    language: args.language,
    force: args.force === "true",
  });

  if (results.length === 0) {
    logger.warn("no se generó ningún video — revisá los logs de asignación guion/archivo arriba");
    process.exit(1);
  }

  for (const result of results) {
    logger.info(result, "video listo");
  }
}

main().catch((err) => {
  logger.error({ err }, "el pipeline falló");
  process.exit(1);
});
