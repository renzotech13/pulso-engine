#!/usr/bin/env tsx
// Procesador por lotes para volumen real (decenas/cientos de videos): lee un
// CSV con una fila por video — qué toma, qué carpeta de fondos, qué título y
// los mismos ajustes que titulo-cli.ts ya expone por flag — y corre
// bg-replace-multi + titulo para cada una, en orden, escribiendo el
// resultado de cada fila (listo/error) DE VUELTA al mismo CSV apenas
// termina. Cortar el proceso a la mitad (Ctrl+C, la Mac se duerme, lo que
// sea) nunca pierde lo ya hecho: la próxima corrida salta toda fila que ya
// diga "listo" y solo repite las pendientes o con error.
//
// Uso:
//   tsx src/lote-cli.ts lote.csv \
//     [--concurrencia 1] [--cuenta aura] [--limite 20] [--modelo ruta.onnx]
//
// Columnas del CSV (encabezado obligatorio, orden libre) — ver
// config/lote-ejemplo.csv para una plantilla lista para copiar a Sheets:
//   id, cuenta            — solo para organizarte, no se usan para procesar.
//   video_persona *       — ruta a la toma con la persona.
//   carpeta_fondos *      — ruta a la carpeta de tomas de fondo.
//   titulo *              — "Nivel 1 | Nivel 2 | NIVEL 3".
//   salida *              — ruta del MP4 final.
//   corte, difuminado     — bg-replace-multi (default 0.5 / 0.15 si vacío).
//   fondo_posicion_y      — bg-replace-multi (default 0.5 = centro de la
//                           toma; bajalo, ej. 0.2, si la toma es vertical y
//                           el centro te cae detrás de la cabeza).
//   preset                — ruta al preset JSON (default aura-edits.json).
//   llenar_superior       — "on" para ajustar el nivel superior al ancho.
//   ancho_maximo, tam_medio, tam_inferior, espacio_medio, espacio_inferior,
//   color_medio, pos_y    — mismos flags de titulo-cli.ts; vacío = default.
//   estado, error         — los escribe el script; no los llenes a mano.
// (*) obligatorias.

import { spawn } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Streams a child process's stdout/stderr to this process's own, live,
 * prefixed with `prefix` — a plain execFile-style promisified run would
 * buffer everything and only hand it back once the whole command exits,
 * which for a 10-20 minute RVM render looks exactly like a hang. The
 * prefix matters even at the default --concurrencia 1: it's what tells you
 * which row a "progreso: ..." line belongs to when you scroll back later.
 */
function runStreaming(cmd: string, args: string[], prefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT });

    const forward = (readable: NodeJS.ReadableStream, writable: NodeJS.WritableStream) => {
      let carry = "";
      readable.on("data", (chunk: Buffer) => {
        carry += chunk.toString();
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) writable.write(`[${prefix}] ${line}\n`);
      });
      readable.on("end", () => {
        if (carry) writable.write(`[${prefix}] ${carry}\n`);
      });
    };
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args.join(" ")}" terminó con código ${code}`));
    });
  });
}

function usageError(): never {
  console.error(
    "uso: tsx src/lote-cli.ts <lote.csv> [--concurrencia 1] [--cuenta nombre] [--limite N] [--modelo ruta.onnx]",
  );
  process.exit(1);
}

function flag(rest: string[], name: string): string | undefined {
  const idx = rest.indexOf(`--${name}`);
  return idx !== -1 && rest[idx + 1] ? rest[idx + 1] : undefined;
}

// --- CSV: un parser/serializador chico a propósito (RFC4180: comillas,
// comas y saltos de línea dentro de un campo entre comillas, "" como comilla
// escapada) — evita depender de una librería nueva para un formato de 19
// columnas fijas. Guarda cada fila como Record<columna,valor> y conserva el
// ORDEN de columnas original al reescribir, así una columna extra que
// agregues a mano (notas, lo que sea) nunca se pierde.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "") || rows.length === 0) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return { headers: [], rows: [] };
  const headers = headerRow.map((h) => h.trim());
  const parsedRows = dataRows
    .filter((r) => r.some((f) => f.trim() !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows: parsedRows };
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function serializeCsv(headers: string[], rows: Record<string, string>[]): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvField(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

// Serializa toda escritura al CSV en una sola fila-a-la-vez, aunque varias
// filas del lote se procesen en paralelo (--concurrencia > 1) — sin esto,
// dos workers guardando el archivo al mismo tiempo podrían pisarse y
// corromperlo.
function createCsvWriter(csvPath: string, headers: string[], rows: Record<string, string>[]) {
  let chain = Promise.resolve();
  return function persist(): Promise<void> {
    chain = chain.then(() => writeFile(csvPath, serializeCsv(headers, rows), "utf8"));
    return chain;
  };
}

function get(row: Record<string, string>, key: string): string {
  return (row[key] ?? "").trim();
}

async function procesarFila(row: Record<string, string>, modelPath: string, id: string): Promise<void> {
  const source = get(row, "video_persona");
  const backgroundFolder = get(row, "carpeta_fondos");
  const titulo = get(row, "titulo");
  const salida = get(row, "salida");
  if (!source || !backgroundFolder || !titulo || !salida) {
    throw new Error("faltan campos obligatorios (video_persona, carpeta_fondos, titulo o salida)");
  }

  const outDir = path.dirname(salida);
  const bgOutput = path.join(outDir, `${path.basename(salida, path.extname(salida))}.__fondo-temp.mp4`);

  const bgArgs = [
    "src/bg-replace-multi-cli.ts",
    source,
    backgroundFolder,
    bgOutput,
    "--modelo", modelPath,
    "--corte", get(row, "corte") || "0.5",
  ];
  if (get(row, "difuminado")) bgArgs.push("--difuminado", get(row, "difuminado"));
  if (get(row, "fondo_posicion_y")) bgArgs.push("--fondo-posicion-y", get(row, "fondo_posicion_y"));
  await runStreaming("tsx", bgArgs, `${id}:fondo`);

  const presetPath = get(row, "preset") || "config/presets/aura-edits.json";
  const tituloArgs = ["src/titulo-cli.ts", bgOutput, salida, titulo, "--preset", presetPath];
  const maybeFlag = (col: string, flagName: string) => {
    const v = get(row, col);
    if (v) tituloArgs.push(`--${flagName}`, v);
  };
  if (get(row, "llenar_superior")) tituloArgs.push("--llenar-superior", get(row, "llenar_superior"));
  maybeFlag("ancho_maximo", "ancho-maximo");
  maybeFlag("tam_medio", "tam-medio");
  maybeFlag("tam_inferior", "tam-inferior");
  maybeFlag("espacio_medio", "espacio-medio");
  maybeFlag("espacio_inferior", "espacio-inferior");
  maybeFlag("color_medio", "color-medio");
  maybeFlag("pos_y", "pos-y");

  try {
    await runStreaming("tsx", tituloArgs, `${id}:titulo`);
  } finally {
    // El fondo intermedio no sirve para nada una vez compuesto el título —
    // se borra pase lo que pase (incluso si titulo-cli falló) para no dejar
    // basura de varios cientos de MB por cada fila procesada.
    await unlink(bgOutput).catch(() => {});
  }
}

/** Procesa `items` con como máximo `limit` corriendo a la vez — cada uno termina antes de que el pool tome el siguiente de la cola. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function lane(): Promise<void> {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

async function main() {
  const [csvPath, ...rest] = process.argv.slice(2);
  if (!csvPath) usageError();

  const modelPath = flag(rest, "modelo") ?? process.env.RVM_MODEL_PATH ?? "";
  if (!modelPath) {
    console.error("Falta el modelo RVM — pasá --modelo <ruta.onnx> o configurá RVM_MODEL_PATH.");
    process.exit(1);
  }
  const concurrencia = Number(flag(rest, "concurrencia") ?? "1");
  const soloCuenta = flag(rest, "cuenta");
  const limite = flag(rest, "limite") ? Number(flag(rest, "limite")) : undefined;

  const resolvedCsvPath = path.resolve(csvPath);
  const { headers, rows } = parseCsv(await readFile(resolvedCsvPath, "utf8"));
  for (const col of ["estado", "error"]) {
    if (!headers.includes(col)) headers.push(col);
  }
  const persist = createCsvWriter(resolvedCsvPath, headers, rows);

  let pendientes = rows.filter((r) => get(r, "estado") !== "listo");
  if (soloCuenta) pendientes = pendientes.filter((r) => get(r, "cuenta") === soloCuenta);
  if (limite !== undefined) pendientes = pendientes.slice(0, limite);

  if (pendientes.length === 0) {
    console.log("nada para procesar — todas las filas ya están en \"listo\" (o el filtro no encontró ninguna).");
    return;
  }
  console.log(`${pendientes.length} video(s) por procesar, ${concurrencia} a la vez…`);

  let done = 0;
  await runWithConcurrency(pendientes, Math.max(1, concurrencia), async (row) => {
    const id = get(row, "id") || get(row, "salida") || "(sin id)";
    try {
      await procesarFila(row, modelPath, id);
      row.estado = "listo";
      row.error = "";
      done++;
      console.log(`[${done}/${pendientes.length}] listo: ${id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      row.estado = "error";
      row.error = message.slice(0, 500);
      done++;
      console.error(`[${done}/${pendientes.length}] error en "${id}": ${message}`);
    } finally {
      await persist();
    }
  });

  const errores = pendientes.filter((r) => get(r, "estado") === "error").length;
  console.log(`terminado — ${pendientes.length - errores} listo(s), ${errores} con error. Revisá la columna "error" en ${csvPath}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
