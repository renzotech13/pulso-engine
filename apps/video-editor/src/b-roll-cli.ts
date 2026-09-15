// Manages a b-roll manifest end to end: "de la toma X usa los segundos 3 a
// 6" is the whole workflow this covers — it runs the actual ffmpeg trim
// AND updates config/b-roll/<cliente>.json in the same step, so the
// manifest text never drifts from what's actually sitting on disk.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadBRollLibrary, resolveBRollFilePath } from "./pipeline/b-roll.js";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

function usageError(): never {
  console.error(
    "uso:\n" +
      "  tsx src/b-roll-cli.ts listar <manifiesto.json>\n" +
      "  tsx src/b-roll-cli.ts cortar <manifiesto.json> <id> <inicioSeg> <finSeg> " +
      "[--fuente ruta-nueva.mp4] [--lut ruta.cube] [--audio]",
  );
  process.exit(1);
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

async function listar(manifestPath: string): Promise<void> {
  const lib = await loadBRollLibrary(manifestPath);
  if (lib.tomas.length === 0) {
    console.log(`"${manifestPath}" no tiene tomas todavía.`);
    return;
  }
  for (const toma of lib.tomas) {
    const estado = toma.listo ? "✓ listo" : "· pendiente";
    console.log(`${estado}  ${toma.id}  [${toma.escena}]  ${toma.etiquetas.join(", ")}`);
    console.log(`    fuente: ${toma.fuente.archivoOriginal} (${toma.fuente.inicioSeg}s → ${toma.fuente.finSeg}s)`);
    if (toma.listo) console.log(`    archivo: ${toma.archivo}${toma.duracionSeg ? ` (${toma.duracionSeg}s)` : ""}`);
    if (toma.descripcion) console.log(`    ${toma.descripcion}`);
  }
}

async function cortar(
  manifestPath: string,
  id: string,
  inicioSeg: number,
  finSeg: number,
  lutPath: string | undefined,
  keepAudio: boolean,
  nuevaFuente: string | undefined,
): Promise<void> {
  if (!Number.isFinite(inicioSeg) || !Number.isFinite(finSeg) || finSeg <= inicioSeg) {
    console.error(`rango inválido: ${inicioSeg}s → ${finSeg}s (finSeg debe ser mayor que inicioSeg)`);
    process.exit(1);
  }

  const lib = await loadBRollLibrary(manifestPath);
  const toma = lib.tomas.find((t) => t.id === id);
  if (!toma) {
    const idsDisponibles = lib.tomas.map((t) => t.id).join(", ") || "(ninguna)";
    console.error(`no existe la toma "${id}" en "${manifestPath}". Ids disponibles: ${idsDisponibles}`);
    process.exit(1);
  }

  // --fuente reemplaza el video original de esta toma (ej. probar un fondo
  // distinto sin tocar el guion ni el resto del manifiesto) — el id, la
  // escena y las etiquetas quedan igual, así que todo lo que ya referencia
  // esta toma la sigue usando sin cambios.
  if (nuevaFuente) toma.fuente.archivoOriginal = nuevaFuente;

  const outputPath = resolveBRollFilePath(toma);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const vf = lutPath ? `format=gbrp16le,lut3d=file=${lutPath}:interp=tetrahedral,format=yuv420p` : undefined;
  const args = ["-y", "-i", toma.fuente.archivoOriginal, "-ss", String(inicioSeg), "-to", String(finSeg)];
  if (vf) args.push("-vf", vf);
  args.push("-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p");
  args.push(...(keepAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]));
  args.push(outputPath);

  try {
    await run("ffmpeg", args, { maxBuffer: MAX_BUFFER });
  } catch (err) {
    if (isEnoent(err)) {
      console.error('"ffmpeg" no está instalado o no está en el PATH.');
    } else {
      console.error(`no se pudo cortar "${toma.fuente.archivoOriginal}":`, err);
    }
    process.exit(1);
  }

  toma.fuente.inicioSeg = inicioSeg;
  toma.fuente.finSeg = finSeg;
  toma.duracionSeg = finSeg - inicioSeg;
  toma.listo = true;
  toma.correccionColorAplicada = Boolean(lutPath);
  toma.conAudio = keepAudio;

  await writeFile(manifestPath, `${JSON.stringify(lib, null, 2)}\n`, "utf8");

  console.log(`listo: ${outputPath} (${toma.duracionSeg}s)`);
  console.log(`manifiesto actualizado: ${manifestPath}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "listar") {
    const [manifestPath] = rest;
    if (!manifestPath) usageError();
    await listar(manifestPath);
    return;
  }

  if (command === "cortar") {
    const [manifestPath, id, inicioRaw, finRaw, ...flags] = rest;
    if (!manifestPath || !id || !inicioRaw || !finRaw) usageError();

    const lutIdx = flags.indexOf("--lut");
    const lutPath = lutIdx !== -1 && flags[lutIdx + 1] ? flags[lutIdx + 1] : undefined;
    const fuenteIdx = flags.indexOf("--fuente");
    const nuevaFuente = fuenteIdx !== -1 && flags[fuenteIdx + 1] ? flags[fuenteIdx + 1] : undefined;
    const keepAudio = flags.includes("--audio");

    await cortar(manifestPath, id, Number(inicioRaw), Number(finRaw), lutPath, keepAudio, nuevaFuente);
    return;
  }

  usageError();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
