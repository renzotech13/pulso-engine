"use client";

import { useRef, useState, type FormEvent } from "react";
import { UploadCloud } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createBgReplaceJobAction } from "@/lib/video-editor-actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass, labelClass } from "@/components/ui/field";

const ASSETS_BUCKET = "video-editor-assets";

/** Storage keys reject some characters a real filename can carry (accents, "#", "?"...). */
function storageSafeName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");
}

function FilePicker({
  label,
  hint,
  accept,
  file,
  onChange,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label className={labelClass}>
        {label}
        <span className="ml-0.5 text-danger">*</span>
      </label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-line-2 px-4 py-5 text-sm text-fg-2 hover:border-accent/60"
      >
        <UploadCloud size={18} aria-hidden="true" />
        <span className="truncate">{file ? file.name : "Elegir archivo"}</span>
      </button>
      <p className="mt-1 text-xs text-fg-3">{hint}</p>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </div>
  );
}

/**
 * Same direct-to-Storage upload as video-upload-form.tsx (raw takes are far
 * bigger than a Server Action body allows), then one call to create the
 * job. Stays on the page afterwards: the job shows up in the list below
 * with its own progress, and the form resets for the next test.
 */
export function BgReplaceForm({ tenantId }: { tenantId: string }) {
  const [source, setSource] = useState<File | null>(null);
  const [background, setBackground] = useState<File | null>(null);
  const [nombre, setNombre] = useState("");
  const [cutPct, setCutPct] = useState(50);
  const [blendPct, setBlendPct] = useState(15);
  const [status, setStatus] = useState<{ label: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped after a successful submit to remount the pickers, which clears
  // the hidden <input type="file"> values along with the React state.
  const [formKey, setFormKey] = useState(0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!source || !background) {
      setStatus({ label: "Faltan archivos: subí el video de la persona y el video de fondo.", error: true });
      return;
    }

    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const folder = `${tenantId}/fondo/${crypto.randomUUID()}`;

    try {
      setStatus({ label: `Subiendo el video de la persona: ${source.name}…` });
      const sourcePath = `${folder}/persona-${storageSafeName(source.name)}`;
      const { error: sourceError } = await supabase.storage.from(ASSETS_BUCKET).upload(sourcePath, source);
      if (sourceError) throw new Error(`no se pudo subir "${source.name}": ${sourceError.message}`);

      setStatus({ label: `Subiendo el video de fondo: ${background.name}…` });
      const backgroundPath = `${folder}/fondo-${storageSafeName(background.name)}`;
      const { error: backgroundError } = await supabase.storage.from(ASSETS_BUCKET).upload(backgroundPath, background);
      if (backgroundError) throw new Error(`no se pudo subir "${background.name}": ${backgroundError.message}`);

      setStatus({ label: "Creando el trabajo…" });
      await createBgReplaceJobAction({
        tenantId,
        nombre: nombre.trim() || source.name,
        sourcePath,
        backgroundPath,
        cutPosition: cutPct / 100,
        blendBand: blendPct / 100,
      });

      setSource(null);
      setBackground(null);
      setNombre("");
      setFormKey((k) => k + 1);
      setStatus({ label: "Listo — el trabajo quedó en cola. Seguí su avance en la lista de abajo." });
    } catch (err) {
      setStatus({ label: err instanceof Error ? err.message : "Algo falló al subir los archivos.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field id="bg-nombre" label="Nombre" hint="Opcional — si lo dejás vacío se usa el nombre del video de la persona.">
        <input
          id="bg-nombre"
          className={inputClass}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. Toma 3 con fondo de oficina"
        />
      </Field>

      <div key={formKey} className="grid gap-5 sm:grid-cols-2">
        <FilePicker
          label="Video de la persona"
          hint="La toma a la que se le aplica RVM para recortar a la persona."
          accept="video/mp4,video/quicktime"
          file={source}
          onChange={setSource}
        />
        <FilePicker
          label="Video de fondo"
          hint="Corre detrás de la persona recortada. Si es más corto que la toma, se repite."
          accept="video/mp4,video/quicktime,image/jpeg,image/png"
          file={background}
          onChange={setBackground}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="bg-corte" className={labelClass}>
            Altura del corte — {cutPct}%
          </label>
          <input
            id="bg-corte"
            type="range"
            min={10}
            max={90}
            step={5}
            value={cutPct}
            onChange={(e) => setCutPct(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <p className="mt-1 text-xs text-fg-3">Arriba del corte se ve el video de fondo; abajo, el fondo original de la toma.</p>
        </div>
        <div>
          <label htmlFor="bg-difuminado" className={labelClass}>
            Difuminado — {blendPct}%
          </label>
          <input
            id="bg-difuminado"
            type="range"
            min={5}
            max={50}
            step={5}
            value={blendPct}
            onChange={(e) => setBlendPct(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <p className="mt-1 text-xs text-fg-3">Qué tan gradual es la transición entre los dos fondos.</p>
        </div>
      </div>

      {status && (
        <p role={status.error ? "alert" : "status"} className={`text-sm ${status.error ? "text-danger" : "text-fg-2"}`}>
          {status.label}
        </p>
      )}

      <Button type="submit" pending={busy} pendingText="Subiendo…">
        Reemplazar fondo
      </Button>
    </form>
  );
}
