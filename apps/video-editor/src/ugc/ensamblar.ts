// Armado de un video UGC a partir de los dos tramos de Veo: recorta cada uno
// justo después de su última palabra, los une (acrossfade de 20 ms), pone el
// destello en el empalme y superpone los elementos elegidos. Es el mismo
// proceso que se validó a mano con build-ugc.py; las reglas aprobadas viven acá:
//  · el video termina donde termina la extensión: sin congelar ni agregar cuadros;
//  · el precio entra cuando se dice el precio y SIEMPRE antes del CTA;
//  · CTA arriba con flecha, pill de WhatsApp abajo desde el CTA hasta el final;
//  · destello sin whoosh (la voz continúa en el corte).

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { UgcElementos } from "@pulso/shared/ugc";

const exec = promisify(execFile);

const HERE = import.meta.dirname;
const VIDEO_EDITOR_DIR = path.resolve(HERE, "../..");
const RENDER_VIDEO_DIR = path.resolve(VIDEO_EDITOR_DIR, "../render-video");
const ASSETS_DIR = path.join(VIDEO_EDITOR_DIR, "assets/ugc");
const CATALOGO_DIR = path.join(VIDEO_EDITOR_DIR, "config/estilos/elementos");
const FLARE_SCRIPT = path.join(VIDEO_EDITOR_DIR, "scripts/efectos/flare-transicion.sh");
const WHISPER_MODEL = process.env.WHISPER_MODEL_PATH ?? path.join(VIDEO_EDITOR_DIR, "models/ggml-small.bin");

const ENC = ["-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30"];

// El servicio corre bajo launchd con PATH mínimo (/usr/bin:/bin): ffmpeg, whisper-cli, python3 y npx
// viven en Homebrew, así que se antepone a mano para los procesos hijos (incluido flare-transicion.sh).
const PATH_HERRAMIENTAS = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;

async function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<string> {
  const { stdout } = await exec(cmd, args, { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PATH: PATH_HERRAMIENTAS }, ...opts });
  return stdout;
}
const ff = (args: string[]) => run("ffmpeg", ["-y", "-loglevel", "error", ...args]);

async function duracion(file: string): Promise<number> {
  return Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).trim());
}

interface Palabra {
  texto: string;
  desde: number;
  hasta: number;
}

/** whisper.cpp solo para medir CUÁNDO cae cada palabra (el texto ya se conoce por el guion). */
async function palabras(mediaPath: string, workDir: string, etiqueta: string): Promise<Palabra[]> {
  const wav = path.join(workDir, `${etiqueta}.wav`);
  await ff(["-i", mediaPath, "-ar", "16000", "-ac", "1", wav]);
  const base = path.join(workDir, `${etiqueta}-w`);
  await run("whisper-cli", ["-m", WHISPER_MODEL, "-l", "es", "-ojf", "-ml", "1", "-sow", "-f", wav, "-of", base]);
  const json = JSON.parse(await readFile(`${base}.json`, "utf8")) as {
    transcription: { text: string; offsets: { from: number; to: number } }[];
  };
  return json.transcription
    .filter((t) => t.text.trim())
    .map((t) => ({ texto: t.text.trim(), desde: t.offsets.from / 1000, hasta: t.offsets.to / 1000 }));
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const fit = (text: string, size: number, maxW: number, k = 0.62) => Math.floor(Math.min(size, maxW / (k * Math.max(text.length, 1))));

async function renderRemotion(props: Record<string, unknown>, outPath: string, composicion: string): Promise<void> {
  const full = { ...props, fps: 30, width: 1080, height: 1920 };
  await run("npx", ["tsx", "src/precio-card-cli.ts", JSON.stringify(full), outPath, composicion], { cwd: RENDER_VIDEO_DIR });
}

export interface EnsamblarOpts {
  workDir: string;
  tramo1: string;
  extension: string;
  elementos: UgcElementos;
  onPaso?: (paso: string, progreso: number) => Promise<void>;
}

export async function ensamblarUgc(o: EnsamblarOpts): Promise<string> {
  const { workDir, elementos: el } = o;
  const paso = o.onPaso ?? (async () => undefined);
  const W = (f: string) => path.join(workDir, f);

  // 1) Cortes justo después de la última palabra de cada tramo.
  await paso("Midiendo dónde termina la voz de cada tramo", 60);
  const w1 = await palabras(o.tramo1, workDir, "t1");
  const w2 = await palabras(o.extension, workDir, "t2");
  const d1 = await duracion(o.tramo1);
  const d2 = await duracion(o.extension);
  const c1 = Math.min((w1.at(-1)?.hasta ?? d1) + 0.12, d1);
  const c2 = Math.min((w2.at(-1)?.hasta ?? d2) + 0.5, d2);

  // 2) Unión de los dos tramos.
  await paso("Uniendo los dos tramos", 66);
  const fc =
    `[0:v]trim=0:${c1},setpts=PTS-STARTPTS,scale=720:1280,fps=30[v0];[1:v]trim=0:${c2},setpts=PTS-STARTPTS,scale=720:1280,fps=30[v1];` +
    `[0:a]atrim=0:${c1},asetpts=PTS-STARTPTS,aresample=48000[a0];[1:a]atrim=0:${c2},asetpts=PTS-STARTPTS,aresample=48000[a1];` +
    "[a0][a1]acrossfade=d=0.02[a];[v0][v1]concat=n=2:v=1:a=0[v]";
  await ff(["-i", o.tramo1, "-i", o.extension, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", ...ENC, "-c:a", "aac", "-b:a", "192k", W("unido.mp4")]);

  // 3) Destello en el empalme (segundo c1), sin whoosh.
  let fuente = W("unido.mp4");
  if (el.destello) {
    await paso("Aplicando el destello en el empalme", 72);
    await run("bash", [FLARE_SCRIPT, W("unido.mp4"), W("destello.mp4"), String(c1), "--paleta", el.destello.paleta, "--sin-whoosh"]);
    fuente = W("destello.mp4");
  }

  // 4) Tiempos de los elementos según lo que dice la voz.
  const dur = await duracion(fuente);
  const wf = await palabras(fuente, workDir, "final");
  const tCta = (wf.filter((p) => norm(p.texto).startsWith("escrib") && p.desde > 4).at(-1)?.desde ?? dur - 2.6) - 0.1;
  const tPrice = wf.find((p) => /^(39|30|treinta)/.test(norm(p.texto)))?.desde ?? dur * 0.42;
  const tMid = Math.max(Math.min(tPrice - 0.3, tCta - 2.2), 3.4); // el precio SIEMPRE antes del CTA
  const tWa = tCta + 0.25;

  // 5) Base a 1080x1920 y elementos.
  await paso("Renderizando títulos, precio y CTA", 78);
  await ff(["-i", fuente, "-vf", "scale=1080:1920:flags=lanczos,fps=30", "-t", String(dur), "-an", ...ENC, W("base.mp4")]);

  const inputs: string[] = ["-i", W("base.mp4")];
  const cadena: string[] = [];
  let n = 0; // índice de la última entrada añadida
  let actual = "0:v";
  const capa = (idx: number, retraso: number, extra = "") => {
    const etiqueta = `l${idx}`;
    cadena.push(`[${idx}:v]${extra}setpts=PTS+${retraso}/TB[${etiqueta}]`);
    return etiqueta;
  };
  const superponer = (etiqueta: string, pos = "0:0") => {
    const sal = `o${n}`;
    cadena.push(`[${actual}][${etiqueta}]overlay=${pos}:eof_action=pass[${sal}]`);
    actual = sal;
  };
  const añadir = (file: string) => {
    inputs.push("-i", file);
    n += 1;
    return n;
  };

  if (el.titulo) {
    const t = el.titulo;
    const dTit = el.tituloDuracion;
    const [l1, l2, l3] = t.lineas;
    const zs = el.zonaSegura;
    if (t.clave === "movistar-titulo-ola") {
      await renderRemotion(
        { durationSec: dTit, linea1: l1, linea2: l2, linea3: l3 ?? "", posicionYFrac: zs ? 0.55 : 0.74, colorLinea1: "#FFFFFF", colorLinea2: "#5FD9F5", colorLinea3: "#FFFFFF",
          tamano1: fit(l1!, zs ? 84 : 112, zs ? 860 : 960), tamano2: fit(l2!, zs ? 128 : 170, zs ? 860 : 960), tamano3: fit(l3 ?? "", zs ? 54 : 70, zs ? 860 : 960), amplitudPx: 7, cicloSeg: 6, escalonSeg: 0.04 },
        W("titulo.mov"), "titulo-olas");
    } else if (t.clave === "movistar-titulo-ola-pill") {
      await renderRemotion(
        { durationSec: dTit, texto1: l1, texto2: l2, posicionYFrac: zs ? 0.55 : 0.0885, colorTexto1: "#FFFFFF", colorTexto2: "#FFFFFF", colorPill: "#3B86E6",
          tamano1: fit(l1!, zs ? 80 : 110, zs ? 860 : 960), tamano2: fit(l2!, zs ? 58 : 78, zs ? 740 : 800), amplitudPx: 7, cicloSeg: 6, escalonSeg: 0.04, entradaPillSeg: 0.7 },
        W("titulo.mov"), "titulo-ola-pill");
    } else {
      await renderRemotion(
        { durationSec: dTit, texto1: l1, texto2: l2, posicionYFrac: zs ? 0.55 : 0.0916, desplazamientoXPx: 0, colorFondo: "#2050B9", colorTexto1: "#FFFFFF", colorTexto2: "#4FE3D6",
          colorChispas: "#4FE3D6", tamano1: fit(l1!, zs ? 50 : 64, zs ? 740 : 800, 0.55), tamano2: fit(l2!, zs ? 66 : 84, zs ? 740 : 800, 0.55), chispaArribaPct: 16, chispaAbajoPct: 72 },
        W("titulo.mov"), "titulo-pill");
    }
    superponer(capa(añadir(W("titulo.mov")), 0.25));
  }

  if (el.precio) {
    if (el.precio.clave === "movistar-pill-stack") {
      const cat = JSON.parse(await readFile(path.join(CATALOGO_DIR, "movistar-pill-stack.json"), "utf8")) as { props: Record<string, unknown> };
      const logo = await readFile(path.join(ASSETS_DIR, "logo-m.png"));
      await renderRemotion(
        { ...cat.props, logoMUrl: `data:image/png;base64,${logo.toString("base64")}`, posicionYFrac: el.zonaSegura ? 0.5664 : 0.87, durationSec: Number((tCta - tMid - 0.1).toFixed(3)) },
        W("precio.mov"), "pill-stack");
      superponer(capa(añadir(W("precio.mov")), tMid, "scale=950:-1,"), "65:43");
    } else {
      // Card ya renderizada y aprobada (sin canal alfa: fondo 0x202020 → colorkey). Se congela un
      // cuadro antes de que arranque su salida para que dure lo que haga falta.
      const cardLen = tCta - tMid;
      await ff(["-i", path.join(ASSETS_DIR, "precio-card-plan-borde-luz.mp4"), "-an", "-vf", "fps=30", ...ENC, W("pr30.mp4")]);
      await ff(["-i", W("pr30.mp4"), "-t", "2.5", ...ENC, W("pr-real.mp4")]);
      await ff(["-i", W("pr30.mp4"), "-ss", "2.5", "-update", "1", "-vframes", "1", W("pr-frame.png")]);
      await ff(["-loop", "1", "-framerate", "30", "-i", W("pr-frame.png"), "-t", "18", "-vf", "scale=1080:1920", ...ENC, W("pr-freeze.mp4")]);
      await writeFile(W("pr.txt"), "file 'pr-real.mp4'\nfile 'pr-freeze.mp4'\n");
      await ff(["-f", "concat", "-safe", "0", "-i", W("pr.txt"), ...ENC, "-t", String(cardLen), W("pr-largo.mp4")]);
      superponer(
        capa(
          añadir(W("pr-largo.mp4")),
          tMid,
          `colorkey=0x202020:0.12:0.08,format=yuva420p,${el.zonaSegura ? "scale=iw*0.85:ih*0.85," : ""}fade=t=out:st=${(cardLen - 0.4).toFixed(2)}:d=0.4:alpha=1,`,
        ),
        el.zonaSegura ? "80:296" : "0:600",
      );
    }
  }

  if (el.cta) {
    await renderRemotion(
      { durationSec: Number((dur - tCta + 1).toFixed(3)), linea1: el.cta.linea1, linea2: el.cta.linea2, posicionYFrac: el.zonaSegura ? 0.2 : 0.075, colorLinea1: "#FFFFFF", colorLinea2: "#5FD9F5",
        tamano1: el.zonaSegura ? 72 : 88, tamano2: el.zonaSegura ? 84 : 100, amplitudPx: 7, cicloSeg: 6, escalonSeg: 0.04, colorFlecha: "#3EC6FF",
        tamanoFlecha: el.zonaSegura ? 64 : 80, retrasoFlechaSeg: 1.1, distanciaFlechaPx: el.zonaSegura ? 105 : 130 },
      W("cta.mov"), "cta-ola");
    superponer(capa(añadir(W("cta.mov")), tCta));
  }

  if (el.whatsapp) {
    await renderRemotion({ durationSec: Number((dur - tWa + 0.5).toFixed(3)), posicionYFrac: el.zonaSegura ? 0.6 : 0.87, anchoPx: el.zonaSegura ? 600 : 720, ...(el.zonaSegura ? { alturaPx: 150 } : {}) }, W("wa.mov"), "whatsapp-pill");
    superponer(capa(añadir(W("wa.mov")), tWa));
  }

  await paso("Componiendo el video final", 90);
  const salida = W("final.mp4");
  if (cadena.length === 0) {
    await ff(["-i", fuente, "-c", "copy", salida]);
    return salida;
  }
  await ff([...inputs, "-filter_complex", cadena.join(";"), "-map", `[${actual}]`, "-an", "-t", String(dur), ...ENC, W("mudo.mp4")]);
  // La voz es la del propio video (Veo): nunca se reemplaza ni se le agrega nada.
  await ff(["-i", W("mudo.mp4"), "-i", fuente, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", salida]);
  return salida;
}
