// Standalone entry point for background-replace.ts — run once per raw take
// that needs it, ahead of the normal `process` pipeline. The output is a
// plain MP4 meant to be passed into `process --videos` like any other file.

import { replaceBackgroundSplit } from "./pipeline/background-replace.js";

function usageError(): never {
  console.error(
    "uso: tsx src/bg-replace-cli.ts <video-origen> <imagen-o-video-fondo> <video-salida> " +
      "[--corte 0.5] [--difuminado 0.15] [--ancho 1080] [--fps 30] [--modelo ruta.onnx] " +
      "[--fondo-posicion-y 0.5]",
  );
  process.exit(1);
}

async function main() {
  const [source, background, output, ...rest] = process.argv.slice(2);
  if (!source || !background || !output) usageError();

  const flag = (name: string, fallback: string): string => {
    const idx = rest.indexOf(`--${name}`);
    return idx !== -1 && rest[idx + 1] ? rest[idx + 1]! : fallback;
  };

  const modelPath = flag("modelo", process.env.RVM_MODEL_PATH ?? "");
  if (!modelPath) {
    console.error("Falta el modelo RVM — pasá --modelo <ruta.onnx> o configurá RVM_MODEL_PATH.");
    process.exit(1);
  }

  await replaceBackgroundSplit(
    source,
    background,
    {
      cutPositionFrac: Number(flag("corte", "0.5")),
      blendBandFrac: Number(flag("difuminado", "0.15")),
      workWidth: Number(flag("ancho", "1080")),
      outputFps: Number(flag("fps", "30")),
      modelPath,
      // Qué franja de la toma de fondo se conserva al recortarla — 0 el
      // borde de arriba, 1 el de abajo, 0.5 (default) el centro. Con una
      // toma vertical, subir esto (ej. 0.2) evita que el centro de la toma
      // caiga justo donde arranca la cabeza de la persona.
      backgroundPositionY: Number(flag("fondo-posicion-y", "0.5")),
    },
    output,
  );

  console.log(`listo: ${output}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
