// Genera una toma con IA vía APIMart (api.apimart.ai) y la descarga a disco —
// el resultado es un mp4 normal, pensado para caer en tomas/ y seguir el
// mismo pipeline de edición (estilo titulo/cta/subtitulos, crop, etc.) que
// una toma de stock. Sin MCP propio: es la API REST directa (sube imagen si
// hay --imagen, crea la tarea de video, hace polling hasta completed).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// El .env vive en la raíz del monorepo (gitignored), no en apps/video-editor —
// process.loadEnvFile no pisa variables ya seteadas en el shell.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // sin .env en la raíz: seguimos, apiKey() abajo se queja si falta la var.
}

const BASE_URL = "https://api.apimart.ai";

function usageError(): never {
  console.error(
    'uso: tsx src/apimart-video-cli.ts "prompt en texto" <video-salida.mp4> ' +
      "[--imagen ruta.jpg] [--imagen-final ruta.jpg] [--modelo kling-v2-6|seedance-1-0-pro-fast|seedance-1-0-pro-quality] " +
      "[--modo std|pro] (solo kling) [--resolucion 480p|720p|1080p] (solo seedance) " +
      "[--duracion 5|10] [--aspecto 16:9|9:16|1:1] [--negativo \"texto\"] [--audio]",
  );
  process.exit(1);
}

function flag(rest: string[], name: string): string | undefined {
  const idx = rest.indexOf(`--${name}`);
  return idx !== -1 && rest[idx + 1] ? rest[idx + 1] : undefined;
}

function apiKey(): string {
  const key = process.env.APIMART_API_KEY;
  if (!key) {
    console.error("Falta APIMART_API_KEY — ponela en el .env de la raíz del monorepo.");
    process.exit(1);
  }
  return key;
}

/** Sube una imagen local y devuelve la URL pública (válida 72h) que la API de generación necesita — no acepta base64 ni rutas locales directamente. */
async function uploadImage(filePath: string): Promise<string> {
  const form = new FormData();
  const buffer = await readFile(filePath);
  // APIMart arma la URL pública pegando el nombre de archivo tal cual, sin
  // encodearlo — un nombre con espacios (típico de un adjunto de WhatsApp)
  // rompe esa URL más adelante ("unescaped whitespace"). Se manda un nombre
  // sin espacios para no depender de que ellos lo encodeen bien.
  const safeName = path.basename(filePath).replace(/\s+/g, "-");
  form.append("file", new Blob([buffer]), safeName);

  const res = await fetch(`${BASE_URL}/v1/uploads/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`subida de imagen falló (${res.status}): ${JSON.stringify(json)}`);
  console.log(`imagen subida: ${filePath} -> ${json.url}`);
  return json.url as string;
}

async function createVideoTask(opts: {
  prompt: string;
  model: string;
  mode: string;
  resolution?: string;
  duration: number;
  aspectRatio: string;
  negativePrompt?: string;
  imageUrls?: string[];
  audio: boolean;
}): Promise<string> {
  // La familia seedance usa un shape distinto al de kling: `image_with_roles`
  // (con role first_frame/last_frame) en vez de `image_urls`, `resolution` en
  // vez de `mode`, y no acepta `mode`/`audio` como los de kling.
  const isSeedance = opts.model.startsWith("seedance");

  const body: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    duration: opts.duration,
    aspect_ratio: opts.aspectRatio,
  };
  if (isSeedance) {
    if (opts.resolution) body.resolution = opts.resolution;
    if (opts.imageUrls?.length) {
      body.image_with_roles = opts.imageUrls.map((url, i) => ({
        url,
        role: i === 0 ? "first_frame" : "last_frame",
      }));
    }
  } else {
    body.mode = opts.mode;
    if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
    if (opts.imageUrls?.length) body.image_urls = opts.imageUrls;
    if (opts.audio) body.audio = true;
  }

  const res = await fetch(`${BASE_URL}/v1/videos/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`creación de tarea falló (${res.status}): ${JSON.stringify(json)}`);
  const taskId = json?.data?.[0]?.task_id;
  if (!taskId) throw new Error(`respuesta sin task_id: ${JSON.stringify(json)}`);
  console.log(`tarea creada: ${taskId}`);
  return taskId;
}

interface TaskResult {
  status: string;
  progress: number;
  result?: { videos?: { url: string[] }[] };
  error?: { message: string };
}

async function pollTask(taskId: string, { timeoutMs = 10 * 60_000, intervalMs = 5000 } = {}): Promise<TaskResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/v1/tasks/${taskId}?language=es`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`consulta de tarea falló (${res.status}): ${JSON.stringify(json)}`);
    const data: TaskResult = json.data;
    console.log(`  [${taskId}] ${data.status} (${data.progress}%)`);
    if (data.status === "completed") return data;
    if (data.status === "failed" || data.status === "cancelled") {
      throw new Error(`tarea ${data.status}: ${data.error?.message ?? "sin detalle"}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`tarea ${taskId} no terminó dentro de ${timeoutMs / 1000}s`);
}

async function downloadVideo(url: string, output: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`descarga del video falló (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(output, buffer);
}

async function main(): Promise<void> {
  const [prompt, output, ...rest] = process.argv.slice(2);
  if (!prompt || !output) usageError();

  const modelo = flag(rest, "modelo") ?? "kling-v2-6";
  const modo = flag(rest, "modo") ?? "std";
  const resolucion = flag(rest, "resolucion");
  const duracion = Number(flag(rest, "duracion") ?? "5");
  const aspecto = flag(rest, "aspecto") ?? "9:16";
  const negativo = flag(rest, "negativo");
  const audio = rest.includes("--audio");
  const imagenPath = flag(rest, "imagen");
  const imagenFinalPath = flag(rest, "imagen-final");

  const imageUrls: string[] = [];
  if (imagenPath) imageUrls.push(await uploadImage(path.resolve(imagenPath)));
  if (imagenFinalPath) imageUrls.push(await uploadImage(path.resolve(imagenFinalPath)));

  const taskId = await createVideoTask({
    prompt,
    model: modelo,
    mode: modo,
    resolution: resolucion,
    duration: duracion,
    aspectRatio: aspecto,
    negativePrompt: negativo,
    imageUrls,
    audio,
  });

  const result = await pollTask(taskId);
  const videoUrl = result.result?.videos?.[0]?.url?.[0];
  if (!videoUrl) throw new Error(`tarea completed sin URL de video: ${JSON.stringify(result)}`);

  await downloadVideo(videoUrl, path.resolve(output));
  console.log(`listo: ${output}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
