// Voz en off del preset "situación": ElevenLabs v3 por voice_id, o un audio ya generado que se subió.
// En los dos casos se puede acelerar sin cambiar el tono (atempo) para calzar el audio con el video.

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PATH_HERRAMIENTAS = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;

export async function ttsElevenLabs(texto: string, voiceId: string, outPath: string): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Falta ELEVENLABS_API_KEY en el .env del worker del editor de video");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: texto, model_id: "eleven_v3" }),
  });
  if (!res.ok) {
    const detalle = (await res.text()).slice(0, 200);
    throw new Error(`ElevenLabs rechazó la voz ${voiceId} (${res.status}): ${detalle}`);
  }
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

/** atempo acepta 0.5–2.0 por filtro; el rango de la interfaz (0.8–1.3) cabe en uno solo. */
export async function ajustarVelocidad(entrada: string, salida: string, velocidad: number): Promise<void> {
  const filtro = Math.abs(velocidad - 1) < 0.001 ? [] : ["-filter:a", `atempo=${velocidad.toFixed(3)}`];
  await exec("ffmpeg", ["-y", "-loglevel", "error", "-i", entrada, ...filtro, "-b:a", "192k", salida], { env: { ...process.env, PATH: PATH_HERRAMIENTAS } });
}
