// Genera una imagen vía APIMart y la descarga a disco — el primer paso del
// flujo "imagen primero, luego animación" (ver apimart-video-cli.ts para el
// segundo paso). Misma cuenta/saldo, mismo patrón de polling.

import { writeFile } from "node:fs/promises";
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // sin .env en la raíz: seguimos, apiKey() abajo se queja si falta la var.
}

const BASE_URL = "https://api.apimart.ai";

function usageError(): never {
  console.error('uso: tsx src/apimart-image-cli.ts "prompt en texto" <salida.png> [--modelo gemini-2.5-flash-image-preview] [--aspecto 9:16]');
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

async function createImageTask(prompt: string, model: string, size: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
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
  result?: { images?: { url: string[] }[] };
  error?: { message: string };
}

async function pollTask(taskId: string, { timeoutMs = 5 * 60_000, intervalMs = 3000 } = {}): Promise<TaskResult> {
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

async function main(): Promise<void> {
  const [prompt, output, ...rest] = process.argv.slice(2);
  if (!prompt || !output) usageError();

  const modelo = flag(rest, "modelo") ?? "gemini-2.5-flash-image-preview";
  const aspecto = flag(rest, "aspecto") ?? "9:16";

  const taskId = await createImageTask(prompt, modelo, aspecto);
  const result = await pollTask(taskId);
  const imageUrl = result.result?.images?.[0]?.url?.[0];
  if (!imageUrl) throw new Error(`tarea completed sin URL de imagen: ${JSON.stringify(result)}`);

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`descarga de imagen falló (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(path.resolve(output), buffer);
  console.log(`listo: ${output}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
