// Thin wrappers around Supabase Storage for the two video-editor buckets.
// Every local ffmpeg/whisper.cpp/Remotion call in the pipeline needs a real
// file on disk — none of them stream from a URL — so anything read from
// Storage gets downloaded to a temp file first, and anything produced gets
// uploaded back up when the stage that made it is done.

import { writeFile, readFile } from "node:fs/promises";
import type { ServiceRoleClient } from "@pulso/db/worker";
import { AppError } from "@pulso/shared/errors";

export const ASSETS_BUCKET = "video-editor-assets";
export const OUTPUT_BUCKET = "video-editor-output";

export class StorageError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "VIDEO_EDITOR_STORAGE_ERROR", cause);
    this.name = "StorageError";
  }
}

export async function downloadToFile(
  client: ServiceRoleClient,
  bucket: string,
  path: string,
  localPath: string,
): Promise<void> {
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error || !data) throw new StorageError(`no se pudo descargar "${bucket}/${path}"`, error);
  await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
}

export async function uploadFile(
  client: ServiceRoleClient,
  bucket: string,
  path: string,
  localPath: string,
  contentType: string,
): Promise<void> {
  const buffer = await readFile(localPath);
  const { error } = await client.storage.from(bucket).upload(path, buffer, { contentType, upsert: true });
  if (error) throw new StorageError(`no se pudo subir "${bucket}/${path}"`, error);
}

export async function uploadBuffer(
  client: ServiceRoleClient,
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage.from(bucket).upload(path, buffer, { contentType, upsert: true });
  if (error) throw new StorageError(`no se pudo subir "${bucket}/${path}"`, error);
}
