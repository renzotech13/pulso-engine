"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withFeedback } from "./flash";
import { createSupabaseServerClient } from "./supabase/server";
import type { Json } from "@pulso/db/types";

// Local mirrors of apps/video-editor's EdlSegment/SubtitleBlock shapes
// (src/pipeline/types.ts) — apps/web has no reason to depend on the
// video-editor package (a pipeline library, not a shared contract) just to
// read/patch a couple of JSONB fields it treats as plain data here.
interface EdlSegment {
  archivo: string;
  inicio: number;
  fin: number;
  lineaGuion: string;
  videoId: string;
  guionTexto?: string;
}
interface Edl {
  videoId: string;
  segmentos: EdlSegment[];
}
interface SubtitleBlock {
  startSec: number;
  endSec: number;
  text: string;
  words: unknown[];
  bajaConfianza: boolean;
}

/**
 * Takes a plain object, not FormData: this runs right after the browser
 * finishes uploading files directly to Storage (video-upload-form.tsx),
 * called as a function from that Client Component rather than via a native
 * form submit — there's no <form> to read FormData from, and the upload
 * has to finish (and produce real storage paths) before this can run at all.
 */
export async function createVideoProjectAction(input: {
  tenantId: string;
  presetId: string;
  nombre: string;
  pdfPath: string;
  musicPath?: string | undefined;
  assets: Array<{ path: string; filename: string }>;
}): Promise<{ projectId: string }> {
  const supabase = await createSupabaseServerClient();

  const { data: project, error: projectError } = await supabase
    .from("video_projects")
    .insert({
      tenant_id: input.tenantId,
      preset_id: input.presetId,
      nombre: input.nombre,
      pdf_path: input.pdfPath,
      music_path: input.musicPath ?? null,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "no se pudo crear el proyecto");
  }

  const { error: assetsError } = await supabase.from("video_assets").insert(
    input.assets.map((a) => ({
      project_id: project.id,
      tenant_id: input.tenantId,
      path: a.path,
      filename: a.filename,
    })),
  );
  if (assetsError) throw new Error(assetsError.message);

  const { error: rpcError } = await supabase.rpc("request_video_project_processing", {
    target_project_id: project.id,
  });
  if (rpcError) throw new Error(rpcError.message);

  revalidatePath("/video-editor");
  return { projectId: project.id };
}

const bgReplaceJobInput = z.object({
  tenantId: z.string().uuid(),
  nombre: z.string().trim().min(1).max(200),
  sourcePath: z.string().min(1),
  backgroundPath: z.string().min(1),
  cutPosition: z.number().min(0).max(1),
  blendBand: z.number().gt(0).max(1),
});

/**
 * Same "upload first, then call as a plain function" flow as
 * createVideoProjectAction — the two files are already in Storage by the
 * time this runs (bg-replace-form.tsx).
 */
export async function createBgReplaceJobAction(input: z.input<typeof bgReplaceJobInput>): Promise<{ jobId: string }> {
  const parsed = bgReplaceJobInput.parse(input);
  // RLS on video_bg_replace_jobs already rejects a foreign tenant_id, but
  // the paths are free text: without this, a row could point the worker
  // (service_role) at another tenant's uploads.
  const tenantPrefix = `${parsed.tenantId}/`;
  if (!parsed.sourcePath.startsWith(tenantPrefix) || !parsed.backgroundPath.startsWith(tenantPrefix)) {
    throw new Error("las rutas de los archivos no pertenecen a este negocio");
  }

  const supabase = await createSupabaseServerClient();
  const { data: job, error: insertError } = await supabase
    .from("video_bg_replace_jobs")
    .insert({
      tenant_id: parsed.tenantId,
      nombre: parsed.nombre,
      source_path: parsed.sourcePath,
      background_path: parsed.backgroundPath,
      cut_position: parsed.cutPosition,
      blend_band: parsed.blendBand,
    })
    .select("id")
    .single();
  if (insertError || !job) throw new Error(insertError?.message ?? "no se pudo crear el trabajo");

  const { error: rpcError } = await supabase.rpc("request_video_bg_replace", { target_job_id: job.id });
  if (rpcError) throw new Error(rpcError.message);

  revalidatePath("/video-editor/fondo");
  return { jobId: job.id };
}

async function saveVideoReviewActionImpl(formData: FormData): Promise<void> {
  const videoId = String(formData.get("videoId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!videoId || !projectId) return;

  const supabase = await createSupabaseServerClient();
  const { data: video, error: fetchError } = await supabase
    .from("video_project_videos")
    .select("edl, subtitulos")
    .eq("id", videoId)
    .single();
  if (fetchError || !video) throw new Error(fetchError?.message ?? "video no encontrado");

  const titulo = String(formData.get("titulo") ?? "").trim() || null;
  const mostrarTitulo = formData.get("mostrarTitulo") === "on";

  // Segments: one "segIncluded_<i>" checkbox + "segInicio_<i>"/"segFin_<i>"
  // text fields per row, indexed the same way the review form rendered
  // them — excluding one just means it's missing from the array we save.
  const originalEdl = (video.edl as Edl | null) ?? { videoId, segmentos: [] };
  const segmentos: EdlSegment[] = originalEdl.segmentos
    .map((segment, i) => {
      const included = formData.get(`segIncluded_${i}`) === "on";
      if (!included) return null;
      const inicio = Number(formData.get(`segInicio_${i}`) ?? segment.inicio);
      const fin = Number(formData.get(`segFin_${i}`) ?? segment.fin);
      return { ...segment, inicio: Number.isFinite(inicio) ? inicio : segment.inicio, fin: Number.isFinite(fin) ? fin : segment.fin };
    })
    .filter((s): s is EdlSegment => s !== null);

  if (segmentos.length === 0) throw new Error("no podés dejar la lista de segmentos vacía");

  const edl: Edl = { ...originalEdl, segmentos };

  const originalSubs = (video.subtitulos as { bloques: SubtitleBlock[] } | null) ?? { bloques: [] };
  const bloques: SubtitleBlock[] = originalSubs.bloques.map((block, i) => {
    const text = String(formData.get(`subText_${i}`) ?? block.text);
    return { ...block, text };
  });

  const { error } = await supabase
    .from("video_project_videos")
    .update({
      titulo,
      mostrar_titulo: mostrarTitulo,
      edl: edl as unknown as Json,
      subtitulos: { ...originalSubs, bloques } as unknown as Json,
    })
    .eq("id", videoId);
  if (error) throw new Error(error.message);

  revalidatePath(`/video-editor/${projectId}/review`);
}

async function requestVideoRenderActionImpl(formData: FormData): Promise<void> {
  const videoId = String(formData.get("videoId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!videoId || !projectId) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_video_render", { target_video_id: videoId });
  if (error) throw new Error(error.message);

  redirect(`/video-editor/${projectId}/results`);
}

async function updateProjectPresetActionImpl(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const presetId = String(formData.get("presetId") ?? "");
  if (!projectId || !presetId) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("video_projects").update({ preset_id: presetId }).eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/video-editor/${projectId}/results`);
}

export const saveVideoReviewAction = withFeedback("Cambios guardados.", saveVideoReviewActionImpl);
// Not wrapped in withFeedback: it redirects straight to /results on success,
// so there's no page left for a flash toast to appear on before that happens.
export const requestVideoRenderAction = requestVideoRenderActionImpl;
export const updateProjectPresetAction = withFeedback("Preset actualizado.", updateProjectPresetActionImpl);
