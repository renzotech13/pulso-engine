// Genera videos UGC desde la terminal con el MISMO código que usa el worker
// (ugc/apimart.ts + ugc/ensamblar.ts), sin pasar por la base de datos.
//   tsx src/ugc-cli.ts <lote.json> <carpeta-salida>
// lote.json: [{ nombre, frame, escena, guionA, guionB, elementos }]  (frame = ruta local)
// Los clips bloqueados por la política de contenido de Veo no cobran: se reintenta hasta 3 veces.

import { mkdir, mkdtemp, readFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { construirPromptUgc, normalizarGuionUgc, ugcElementosSchema } from "@pulso/shared/ugc";
import { extenderTramo, generarPrimerTramo, saldoApimart, subirImagen } from "./ugc/apimart.js";
import { ensamblarUgc } from "./ugc/ensamblar.js";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  /* sin .env raíz: apimart.ts avisa si falta la clave */
}

interface Item {
  nombre: string;
  frame: string;
  escena: string;
  guionA: string;
  guionB: string;
  elementos: unknown;
}

async function conReintentos<T>(etiqueta: string, fn: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (intento >= 3 || !/content policy|Blocked/i.test(msg)) throw e;
      console.log(`[${etiqueta}] bloqueado por la política de contenido (no cobra), reintento ${intento}…`);
    }
  }
}

async function hacer(item: Item, salida: string): Promise<void> {
  const tag = item.nombre;
  const work = await mkdtemp(path.join(tmpdir(), "ugc-cli-"));
  try {
    const elementos = ugcElementosSchema.parse(item.elementos);
    const t1 = path.join(work, "tramo1.mp4");
    const ext = path.join(work, "extension.mp4");
    const url = await subirImagen(item.frame);
    console.log(`[${tag}] generando el primer tramo…`);
    const a = await conReintentos(tag, () => generarPrimerTramo("veo3.1-fast", construirPromptUgc(item.escena, normalizarGuionUgc(item.guionA), false), url, t1));
    console.log(`[${tag}] extendiendo…`);
    const b = await conReintentos(tag, () => extenderTramo("veo3.1-fast", construirPromptUgc(item.escena, normalizarGuionUgc(item.guionB), true), a.taskId, ext));
    console.log(`[${tag}] armando… (costo ${(a.costoUsd + b.costoUsd).toFixed(2)})`);
    const final = await ensamblarUgc({ workDir: work, tramo1: t1, extension: ext, elementos });
    await copyFile(final, path.join(salida, `${tag}.mp4`));
    await copyFile(t1, path.join(salida, "_tramos", `${tag}-A.mp4`));
    await copyFile(ext, path.join(salida, "_tramos", `${tag}-B.mp4`));
    console.log(`[${tag}] LISTO`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const [loteFile, salida] = process.argv.slice(2);
if (!loteFile || !salida) {
  console.error("uso: tsx src/ugc-cli.ts <lote.json> <carpeta-salida>");
  process.exit(1);
}
await mkdir(path.join(salida, "_tramos"), { recursive: true });
const items = JSON.parse(await readFile(loteFile, "utf8")) as Item[];
const saldo0 = await saldoApimart();
console.log(`saldo antes: US$${saldo0.toFixed(2)}`);
const resultados = await Promise.allSettled(items.map((i) => hacer(i, salida)));
resultados.forEach((r, k) => r.status === "rejected" && console.error(`[${items[k]!.nombre}] FALLO:`, r.reason instanceof Error ? r.reason.message : r.reason));
const saldo1 = await saldoApimart();
console.log(`saldo después: US$${saldo1.toFixed(2)} (gastado US$${(saldo0 - saldo1).toFixed(2)})`);
