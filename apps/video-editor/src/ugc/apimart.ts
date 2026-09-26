// Cliente mínimo de APIMart para la Fábrica de video UGC (Veo 3.1 fast).
// Solo lo que el flujo aprobado necesita: subir el cuadro inicial, crear el
// primer tramo (8 s), extenderlo con /remix en modo `raw` (devuelve SOLO el
// tramo nuevo de ~7 s: sin `raw` APIMart regenera los 14 s y reacomoda el
// audio, y el empalme se come la primera palabra), y consultar el saldo.
// La clave vive en el .env del worker; nunca llega al navegador.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://api.apimart.ai";

function apiKey(): string {
  const key = process.env.APIMART_API_KEY;
  if (!key) throw new Error("Falta APIMART_API_KEY en el .env del worker del editor de video");
  return key;
}

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${route}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`APIMart ${route} respondió algo que no es JSON (${res.status})`);
  }
  if (!res.ok) throw new Error(`APIMart ${route} falló (${res.status}): ${text.slice(0, 300)}`);
  return json as T;
}

export async function saldoApimart(): Promise<number> {
  const r = await api<{ remain_balance: number }>("GET", "/v1/user/balance");
  return r.remain_balance;
}

export async function subirImagen(filePath: string): Promise<string> {
  const form = new FormData();
  const safeName = path.basename(filePath).replace(/\s+/g, "-");
  form.append("file", new Blob([await readFile(filePath)]), safeName);
  const res = await fetch(`${BASE_URL}/v1/uploads/images`, { method: "POST", headers: { Authorization: `Bearer ${apiKey()}` }, body: form });
  const json = (await res.json().catch(() => null)) as { url?: string } | null;
  if (!res.ok || !json?.url) throw new Error(`no se pudo subir la imagen a APIMart (${res.status})`);
  return json.url;
}

interface TaskData {
  status: string;
  cost?: number;
  error?: { message?: string };
  result?: { videos?: { url: string[] }[]; images?: { url: string[] }[] };
}

async function pollTask(taskId: string, timeoutMs = 12 * 60_000): Promise<TaskData> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    const { data } = await api<{ data: TaskData }>("GET", `/v1/tasks/${taskId}`);
    if (data.status === "completed") return data;
    if (data.status === "failed" || data.status === "cancelled") {
      throw new Error(`APIMart: ${data.error?.message ?? data.status}`);
    }
  }
  throw new Error(`la tarea ${taskId} de APIMart no terminó en ${timeoutMs / 60000} min`);
}

async function descargar(task: TaskData, outPath: string): Promise<void> {
  const url = task.result?.videos?.[0]?.url?.[0];
  if (!url) throw new Error("APIMart no devolvió la URL del video");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`descarga del video falló (${res.status})`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

export interface TramoResult {
  taskId: string;
  costoUsd: number;
}

/** Primer tramo de 8 s desde el cuadro inicial (URL ya subida). */
export async function generarPrimerTramo(model: string, prompt: string, imageUrl: string, outPath: string): Promise<TramoResult> {
  const r = await api<{ data: { task_id: string }[] }>("POST", "/v1/videos/generations", {
    model,
    prompt,
    duration: 8,
    aspect_ratio: "9:16",
    image_urls: [imageUrl],
  });
  const taskId = r.data?.[0]?.task_id;
  if (!taskId) throw new Error("APIMart no devolvió task_id");
  const task = await pollTask(taskId);
  await descargar(task, outPath);
  return { taskId, costoUsd: task.cost ?? 0 };
}

/** Extensión `raw` (solo el tramo nuevo) a partir del task_id del primer tramo. */
export async function extenderTramo(model: string, prompt: string, primerTaskId: string, outPath: string): Promise<TramoResult> {
  const r = await api<{ data: { task_id: string }[] }>("POST", `/v1/videos/${primerTaskId}/remix`, {
    model,
    prompt,
    raw: true,
    aspect_ratio: "9:16",
    resolution: "720p",
  });
  const taskId = r.data?.[0]?.task_id;
  if (!taskId) throw new Error("APIMart no devolvió task_id de la extensión");
  const task = await pollTask(taskId);
  await descargar(task, outPath);
  return { taskId, costoUsd: task.cost ?? 0 };
}

// ───────── Preset "situación con voz en off": imágenes (gpt-image-2) y video mudo (Seedance 1.0 Pro Fast) ─────────

/** Imagen 9:16 (1024x1536 recortada a 1080x1920). `refUrl` = foto de la misma persona (toma 1) para mantenerla. */
export async function generarImagenSituacion(prompt: string, outPath: string, refUrl?: string | string[]): Promise<{ costoUsd: number }> {
  const body: Record<string, unknown> = { model: "gpt-image-2", prompt, size: "1024x1536", n: 1 };
  if (refUrl) body.image_urls = Array.isArray(refUrl) ? refUrl : [refUrl];
  const r = await api<{ data: { task_id: string }[] }>("POST", "/v1/images/generations", body);
  const taskId = r.data?.[0]?.task_id;
  if (!taskId) throw new Error("APIMart no devolvió task_id de la imagen");
  const task = await pollTask(taskId, 8 * 60_000);
  const url = task.result?.images?.[0]?.url?.[0];
  if (!url) throw new Error("APIMart no devolvió la imagen");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`descarga de la imagen falló (${res.status})`);
  const sharp = (await import("sharp")).default;
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1536;
  const tw = Math.round((h * 9) / 16);
  await sharp(buf)
    .extract({ left: Math.max(0, Math.floor((w - tw) / 2)), top: 0, width: Math.min(tw, w), height: h })
    .resize(1080, 1920)
    .png()
    .toFile(outPath);
  return { costoUsd: task.cost ?? 0 };
}

/** Video de 5 s desde una imagen con Seedance 1.0 Pro Fast 720p (sin audio). */
export async function generarVideoSeedance(prompt: string, imageUrl: string, outPath: string): Promise<{ costoUsd: number }> {
  const r = await api<{ data: { task_id: string }[] }>("POST", "/v1/videos/generations", {
    model: "seedance-1-0-pro-fast",
    prompt,
    duration: 5,
    resolution: "720p",
    aspect_ratio: "9:16",
    image_with_roles: [{ url: imageUrl, role: "first_frame" }],
  });
  const taskId = r.data?.[0]?.task_id;
  if (!taskId) throw new Error("APIMart no devolvió task_id del video");
  const task = await pollTask(taskId);
  await descargar(task, outPath);
  return { costoUsd: task.cost ?? 0 };
}
