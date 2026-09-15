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
//
// O ninguno de los dos: si el guion trae una línea "Carpeta: ADS-01" por
// video, pasá --tomas-base-dir apuntando a la carpeta raíz de las tomas y
// se resuelven solas (ver resolveVideoPathsForScript en project.ts).
// Agregá --b-roll (manifiesto de b-roll.ts) para que las escenas con
// "[fondo: ...]"/"[apoyo: ...]" se traten automáticamente antes de render.

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

  const hasExplicitVideos = Boolean(args.videos || args["videos-dir"]);
  if (!args.pdf || !args.out || (!hasExplicitVideos && !args["tomas-base-dir"])) {
    console.error(
      "uso: tsx src/cli.ts --pdf guion.pdf --out ./salida " +
        "(--videos a.mp4,b.mp4 | --videos-dir carpeta | --tomas-base-dir carpeta [--b-roll manifiesto.json]) " +
        "[--preset ruta.json] [--music cancion.mp3] [--rvm-modelo ruta.onnx] [--force] [--language es]",
    );
    process.exit(1);
  }

  const videoPaths = args["videos-dir"]
    ? await listMp4sInDir(path.resolve(args["videos-dir"]))
    : args.videos
      ? args.videos.split(",").map((p) => path.resolve(p.trim()))
      : [];

  if (hasExplicitVideos && videoPaths.length === 0) {
    console.error("no se encontró ningún .mp4 para procesar");
    process.exit(1);
  }

  const results = await processProject({
    videoPaths,
    pdfPath: path.resolve(args.pdf!),
    outDir: path.resolve(args.out!),
    language: args.language,
    presetPath: args.preset ? path.resolve(args.preset) : undefined,
    musicPath: args.music ? path.resolve(args.music) : undefined,
    force: args.force === "true",
    tomasBaseDir: args["tomas-base-dir"] ? path.resolve(args["tomas-base-dir"]) : undefined,
    bRollLibraryPath: args["b-roll"] ? path.resolve(args["b-roll"]) : undefined,
    rvmModelPath: args["rvm-modelo"] ? path.resolve(args["rvm-modelo"]) : undefined,
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
