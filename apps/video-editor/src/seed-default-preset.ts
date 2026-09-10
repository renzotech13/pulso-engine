#!/usr/bin/env tsx
// Inserts (or updates) the global default preset row so "Nuevo proyecto" has
// something to select without every tenant needing to create their own —
// same tenant_id-null-means-global pattern as render_templates/agents_registry.
//
// usage: tsx src/seed-default-preset.ts

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServiceRoleClient } from "@pulso/db/worker";
import { presetSchema } from "./pipeline/preset.js";

const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "presets", "default.json");
const config = presetSchema.parse(JSON.parse(await readFile(configPath, "utf8")));

const service = createServiceRoleClient();

const { data: existing } = await service
  .from("video_presets")
  .select("id")
  .is("tenant_id", null)
  .eq("nombre", config.nombre)
  .maybeSingle();

if (existing) {
  const { error } = await service.from("video_presets").update({ config }).eq("id", existing.id);
  if (error) throw new Error(error.message);
  console.log("preset global actualizado:", existing.id);
} else {
  const { data, error } = await service
    .from("video_presets")
    .insert({ tenant_id: null, nombre: config.nombre, config })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  console.log("preset global creado:", data.id);
}
