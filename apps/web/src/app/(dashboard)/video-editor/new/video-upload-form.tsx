"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { UploadCloud, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createVideoProjectAction } from "@/lib/video-editor-actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass, labelClass, selectClass } from "@/components/ui/field";

const ASSETS_BUCKET = "video-editor-assets";

interface Preset {
  id: string;
  nombre: string;
}

/**
 * Uploads go straight from the browser to Storage — a Server Action's body
 * is capped well below what a few minutes of raw 1080p footage weighs, so
 * the files never pass through the Next.js server at all. Only once every
 * file has a real path does this call createVideoProjectAction directly
 * (a Server Action invoked as a plain function, not via a form submit —
 * the upload has to finish first, and a native <form> can't sequence that).
 */
export function VideoUploadForm({ tenantId, presets }: { tenantId: string; presets: Preset[] }) {
  const router = useRouter();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  const [videos, setVideos] = useState<File[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [music, setMusic] = useState<File | null>(null);
  const [nombre, setNombre] = useState("");
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const [status, setStatus] = useState<{ label: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (videos.length === 0 || !pdf || !nombre.trim() || !presetId) {
      setStatus({ label: "Faltan campos: nombre, al menos un video y el PDF del guion son obligatorios.", error: true });
      return;
    }

    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const projectFolder = `${tenantId}/${crypto.randomUUID()}`;

    try {
      setStatus({ label: `Subiendo el PDF del guion…` });
      const pdfPath = `${projectFolder}/guion.pdf`;
      const { error: pdfError } = await supabase.storage.from(ASSETS_BUCKET).upload(pdfPath, pdf);
      if (pdfError) throw new Error(`no se pudo subir el PDF: ${pdfError.message}`);

      let musicPath: string | undefined;
      if (music) {
        setStatus({ label: `Subiendo la música…` });
        musicPath = `${projectFolder}/musica-${music.name}`;
        const { error: musicError } = await supabase.storage.from(ASSETS_BUCKET).upload(musicPath, music);
        if (musicError) throw new Error(`no se pudo subir la música: ${musicError.message}`);
      }

      const assets: Array<{ path: string; filename: string }> = [];
      for (const [i, video] of videos.entries()) {
        setStatus({ label: `Subiendo video ${i + 1} de ${videos.length}: ${video.name}…` });
        const videoPath = `${projectFolder}/videos/${i}-${video.name}`;
        const { error: videoError } = await supabase.storage.from(ASSETS_BUCKET).upload(videoPath, video);
        if (videoError) throw new Error(`no se pudo subir "${video.name}": ${videoError.message}`);
        assets.push({ path: videoPath, filename: video.name });
      }

      setStatus({ label: "Creando el proyecto…" });
      const result = await createVideoProjectAction({
        tenantId,
        presetId,
        nombre: nombre.trim(),
        pdfPath,
        musicPath,
        assets,
      });

      router.push(`/video-editor/${result.projectId}/review`);
    } catch (err) {
      setStatus({ label: err instanceof Error ? err.message : "Algo falló al subir los archivos.", error: true });
      setBusy(false);
    }
  }

  function removeVideo(index: number) {
    setVideos((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field id="nombre" label="Nombre del proyecto" required>
        <input
          id="nombre"
          className={inputClass}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. Campaña de formalización — septiembre"
          required
        />
      </Field>

      <Field id="presetId" label="Preset (línea gráfica)" required>
        <select id="presetId" className={selectClass} value={presetId} onChange={(e) => setPresetId(e.target.value)} required>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <label className={labelClass}>Videos en crudo (uno o más .mp4) *</label>
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-line-2 px-4 py-5 text-sm text-fg-2 hover:border-accent/60"
        >
          <UploadCloud size={18} aria-hidden="true" />
          Elegir videos
        </button>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4"
          multiple
          className="hidden"
          onChange={(e) => setVideos((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
        />
        {videos.length > 0 && (
          <ul className="mt-2 space-y-1">
            {videos.map((v, i) => (
              <li key={`${v.name}-${i}`} className="flex items-center justify-between rounded-btn bg-surface-2 px-3 py-1.5 text-sm text-fg-2">
                {v.name}
                <button type="button" onClick={() => removeVideo(i)} aria-label={`Quitar ${v.name}`} className="text-fg-3 hover:text-danger">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className={labelClass}>PDF del guion *</label>
        <button
          type="button"
          onClick={() => pdfInputRef.current?.click()}
          className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-line-2 px-4 py-5 text-sm text-fg-2 hover:border-accent/60"
        >
          <UploadCloud size={18} aria-hidden="true" />
          {pdf ? pdf.name : "Elegir PDF"}
        </button>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
        />
      </div>

      <div>
        <label className={labelClass}>Música (opcional)</label>
        <button
          type="button"
          onClick={() => musicInputRef.current?.click()}
          className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-line-2 px-4 py-5 text-sm text-fg-2 hover:border-accent/60"
        >
          <UploadCloud size={18} aria-hidden="true" />
          {music ? music.name : "Elegir música (.mp3)"}
        </button>
        <input
          ref={musicInputRef}
          type="file"
          accept="audio/mpeg,audio/mp3"
          className="hidden"
          onChange={(e) => setMusic(e.target.files?.[0] ?? null)}
        />
      </div>

      {status && <p className={`text-sm ${status.error ? "text-danger" : "text-fg-2"}`}>{status.label}</p>}

      <Button type="submit" pending={busy} pendingText="Subiendo…">
        Procesar
      </Button>
    </form>
  );
}
