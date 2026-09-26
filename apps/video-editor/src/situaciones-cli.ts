// tsx src/situaciones-cli.ts <carpeta-lote> <id> [<id> ...]   (carpeta con lote.json y una subcarpeta por id con voz.mp3 y toma-1..4.mp4)
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { armarSituacion } from "./ugc/situaciones.js";

const [carpeta, ...ids] = process.argv.slice(2);
if (!carpeta) throw new Error("uso: tsx src/situaciones-cli.ts <carpeta-lote> [ids…]");
const lote = JSON.parse(await readFile(path.join(carpeta, "lote.json"), "utf8")) as {
  id: string;
  titulo: { clave: string; lineas: string[] };
  precio: string;
  cola?: number;
}[];
await mkdir(path.join(carpeta, "salida"), { recursive: true });
for (const it of lote.filter((x) => ids.length === 0 || ids.includes(x.id))) {
  const d = path.join(carpeta, it.id);
  const work = await mkdtemp(path.join(tmpdir(), "sit-"));
  try {
    const out = await armarSituacion({
      workDir: work,
      voz: path.join(d, "voz.mp3"),
      tomas: [1, 2, 3, 4].map((i) => path.join(d, `toma-${i}.mp4`)) as [string, string, string, string],
      titulo: it.titulo,
      precio: it.precio,
      ...(it.cola !== undefined ? { colaSeg: it.cola } : {}),
      salida: path.join(carpeta, "salida", it.id),
    });
    console.log("ok", it.id, out.map((o) => path.basename(o)).join(" "));
  } catch (e) {
    console.error("FALLO", it.id, e instanceof Error ? e.message : e);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
