// Preset "situación con voz en off": 4 tomas (Seedance 1.0 Pro Fast) repartidas según lo que dice la voz
// (Luisa, ElevenLabs v3) + los mismos elementos de marca del preset UGC (título, precio, CTA, pill de
// WhatsApp) con zona segura, en 9:16 y 4:5. Sin destello entre tomas y sin toma final reciclada.
// El video termina 0.5 s después de la última palabra de la voz.

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ugcElementosSchema, type UgcElementos } from "@pulso/shared/ugc";
import { componerElementos } from "./ensamblar.js";

const exec = promisify(execFile);
const PATH_HERRAMIENTAS = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
const WHISPER_MODEL = process.env.WHISPER_MODEL_PATH ?? path.resolve(import.meta.dirname, "../../models/ggml-small.bin");
const ENC = ["-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30"];

async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec(cmd, args, { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PATH: PATH_HERRAMIENTAS } });
}
const ff = (args: string[]) => run("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const dur = async (f: string) => Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).stdout.trim());

interface Palabra {
  texto: string;
  desde: number;
}

async function palabras(voz: string, workDir: string): Promise<Palabra[]> {
  const wav = path.join(workDir, "voz.wav");
  await ff(["-i", voz, "-ar", "16000", "-ac", "1", wav]);
  const base = path.join(workDir, "voz-w");
  await run("whisper-cli", ["-m", WHISPER_MODEL, "-l", "es", "-ojf", "-ml", "1", "-sow", "-f", wav, "-of", base]);
  const j = JSON.parse(await readFile(`${base}.json`, "utf8")) as { transcription: { text: string; offsets: { from: number } }[] };
  return j.transcription.filter((t) => t.text.trim()).map((t) => ({ texto: t.text.trim(), desde: t.offsets.from / 1000 }));
}

/**
 * Segundo en que la voz deja de sonar. Solo cuenta el silencio FINAL: un silencio que empieza y
 * nunca termina antes del fin del archivo. Una pausa en medio de la voz (que sí tiene su
 * silence_end) no es el final — tomarla cortaba la última frase ("Escríbenos por WhatsApp").
 */
async function finDeVoz(voz: string): Promise<number> {
  const total = await dur(voz);
  const { stderr } = await run("ffmpeg", ["-i", voz, "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"]);
  const eventos = [...stderr.matchAll(/silence_(start|end): ([\d.]+)/g)].map((m) => ({ tipo: m[1], t: Number(m[2]) }));
  const ultimo = eventos.at(-1);
  return ultimo?.tipo === "start" && total - ultimo.t < 3 ? ultimo.t : total;
}

export interface SituacionOpts {
  workDir: string;
  voz: string;
  tomas: [string, string, string, string];
  titulo: { clave: string; lineas: string[] };
  precio: string;
  /** Elementos elegidos (título, precio, CTA, WhatsApp…); el destello se ignora: en situaciones no hay empalmes. */
  elementos?: UgcElementos;
  /** Segundos que dura el video tras la última palabra de la voz (default 0.5). */
  colaSeg?: number;
  /** Carpeta y prefijo de salida: escribe <salida>-9x16.mp4 y <salida>-4x5.mp4 */
  salida: string;
}

export async function armarSituacion(o: SituacionOpts): Promise<string[]> {
  const W = (f: string) => path.join(o.workDir, f);
  const fin = await finDeVoz(o.voz);
  const total = fin + (o.colaSeg ?? 0.5);
  const ws = await palabras(o.voz, o.workDir);

  // 3 cortes en el inicio de una frase cercano a 1/4, 2/4 y 3/4 de la voz (fallback: los cuartos exactos).
  const inicios = ws.filter((_, i) => i > 0 && /[.,?!…]$/.test(ws[i - 1]!.texto)).map((p) => p.desde);
  const cortes = [0];
  for (const k of [1, 2, 3]) {
    const objetivo = (total * k) / 4;
    const cand = inicios.filter((s) => Math.abs(s - objetivo) < 1.4 && s > cortes.at(-1)! + 2.2 && s < total - 2.2 * (4 - k));
    cortes.push(cand.length ? cand.reduce((a, b) => (Math.abs(a - objetivo) < Math.abs(b - objetivo) ? a : b)) : objetivo);
  }
  cortes.push(total);

  const partes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const largo = cortes[i + 1]! - cortes[i]!;
    const origen = await dur(o.tomas[i]!);
    const salidaParte = W(`t${i + 1}.mp4`);
    await ff(["-i", o.tomas[i]!, "-vf", `scale=720:1280:flags=lanczos,setpts=PTS*${(largo / origen).toFixed(5)},fps=30`, "-t", String(largo), "-an", ...ENC, salidaParte]);
    partes.push(salidaParte);
  }
  await writeFile(W("lista.txt"), partes.map((p) => `file '${p}'`).join("\n"));
  await ff(["-f", "concat", "-safe", "0", "-i", W("lista.txt"), ...ENC, W("base.mp4")]);
  await ff(["-i", W("base.mp4"), "-i", o.voz, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(total), W("base-voz.mp4")]);

  const salidas: string[] = [];
  for (const formato of ["9:16", "4:5"] as const) {
    const wd = W(`fmt-${formato.replace(":", "x")}`);
    await run("mkdir", ["-p", wd]);
    const elementos = ugcElementosSchema.parse(
      o.elementos
        ? { ...o.elementos, destello: null, zonaSegura: true, formato }
        : {
            titulo: { clave: o.titulo.clave, lineas: o.titulo.lineas },
            tituloDuracion: 3,
            precio: { clave: o.precio },
            cta: { clave: "movistar-cta-ola", linea1: "ESCRÍBENOS", linea2: "POR WHATSAPP" },
            whatsapp: true,
            destello: null,
            zonaSegura: true,
            formato,
          },
    );
    const final = await componerElementos({ workDir: wd, fuente: W("base-voz.mp4"), elementos });
    const dest = `${o.salida}-${formato.replace(":", "x")}.mp4`;
    await run("cp", [final, dest]);
    salidas.push(dest);
  }
  return salidas;
}
