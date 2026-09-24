"use client";

import { useRef, useState, type FormEvent } from "react";
import { ChevronDown, ImagePlus, Plus, Trash2, Wand2 } from "lucide-react";
import {
  ELEMENTOS_POR_DEFECTO,
  PALETAS_DESTELLO,
  UGC_COSTO_ESTIMADO_USD,
  UGC_ELEMENTOS_CATALOGO,
  UGC_MODELS,
  normalizarGuionUgc,
  type UgcElementos,
} from "@pulso/shared/ugc";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createUgcJobsAction } from "@/lib/ugc-actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass, labelClass, selectClass, textareaClass } from "@/components/ui/field";

const ASSETS_BUCKET = "video-editor-assets";
const storageSafeName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");

interface Fila {
  id: string;
  nombre: string;
  escena: string;
  guionA: string;
  guionB: string;
  lineas: [string, string, string];
  foto: File | null;
}

const filaVacia = (): Fila => ({ id: crypto.randomUUID(), nombre: "", escena: "", guionA: "", guionB: "", lineas: ["", "", ""], foto: null });

const GRUPOS: { id: string; titulo: string }[] = [
  { id: "titulo", titulo: "Título inicial (3 s)" },
  { id: "precio", titulo: "Precio (siempre antes del CTA)" },
  { id: "cta", titulo: "CTA con flecha (arriba)" },
  { id: "whatsapp", titulo: "Pill de WhatsApp (abajo)" },
  { id: "destello", titulo: "Transición" },
];

/** Palabras aproximadas que caben en un tramo: ~2.5 palabras/s → 8 s ≈ 20, 7 s ≈ 17. */
const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

function FotoPicker({ file, onChange, compacto }: { file: File | null; onChange: (f: File | null) => void; compacto?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-line-2 text-fg-2 hover:border-accent/60 ${
          compacto ? "px-2 py-2 text-xs" : "px-4 py-8 text-sm"
        }`}
      >
        <ImagePlus size={compacto ? 14 : 18} aria-hidden="true" />
        <span className="truncate">{file ? file.name : compacto ? "Foto" : "Elegir la foto de la protagonista (primer cuadro)"}</span>
      </button>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </>
  );
}

export function UgcForm({ tenantId }: { tenantId: string }) {
  const [lote, setLote] = useState(false);
  const [model, setModel] = useState<string>(UGC_MODELS[0].id);
  const [filas, setFilas] = useState<Fila[]>([filaVacia()]);
  const [elementos, setElementos] = useState<UgcElementos>(ELEMENTOS_POR_DEFECTO);
  const [pegar, setPegar] = useState("");
  const [estado, setEstado] = useState<{ texto: string; error?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const tituloDef = UGC_ELEMENTOS_CATALOGO.find((e) => e.clave === elementos.titulo?.clave);
  const lineasTitulo = tituloDef?.lineas ?? 0;
  const activos = [elementos.titulo, elementos.precio, elementos.cta, elementos.whatsapp || null, elementos.destello].filter(Boolean).length;
  const total = filas.length;

  const setFila = (id: string, patch: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const setLinea = (id: string, i: number, v: string) =>
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, lineas: f.lineas.map((l, k) => (k === i ? v : l)) as Fila["lineas"] } : f)));

  function toggleElemento(clave: string, grupo: string) {
    setElementos((prev) => {
      const next = { ...prev };
      const activo =
        (grupo === "titulo" && prev.titulo?.clave === clave) ||
        (grupo === "precio" && prev.precio?.clave === clave) ||
        (grupo === "cta" && prev.cta !== null) ||
        (grupo === "whatsapp" && prev.whatsapp) ||
        (grupo === "destello" && prev.destello !== null);
      if (grupo === "titulo") next.titulo = activo ? null : { clave: clave as never, lineas: prev.titulo?.lineas ?? ["", ""] };
      if (grupo === "precio") next.precio = activo ? null : { clave: clave as never };
      if (grupo === "cta") next.cta = activo ? null : { clave: "movistar-cta-ola", linea1: "ESCRÍBENOS", linea2: "POR WHATSAPP" };
      if (grupo === "whatsapp") next.whatsapp = !activo;
      if (grupo === "destello") next.destello = activo ? null : { paleta: "frio" };
      return next;
    });
  }

  function estaActivo(clave: string, grupo: string): boolean {
    if (grupo === "titulo") return elementos.titulo?.clave === clave;
    if (grupo === "precio") return elementos.precio?.clave === clave;
    if (grupo === "cta") return elementos.cta !== null;
    if (grupo === "whatsapp") return elementos.whatsapp;
    return elementos.destello !== null;
  }

  /** Tabla pegada: nombre ; escena ; guion A ; guion B ; línea 1 ; línea 2 ; línea 3 (separador ; o tab). Las fotos se eligen fila por fila. */
  function importarTabla() {
    const nuevas = pegar
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(/\t|;/).map((c) => c.trim()))
      .map((c) => ({ ...filaVacia(), nombre: c[0] ?? "", escena: c[1] ?? "", guionA: c[2] ?? "", guionB: c[3] ?? "", lineas: [c[4] ?? "", c[5] ?? "", c[6] ?? ""] as Fila["lineas"] }));
    if (nuevas.length === 0) return;
    setFilas((fs) => [...fs.filter((f) => f.nombre || f.guionA), ...nuevas].slice(0, 30));
    setPegar("");
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    const usadas = lote ? filas : filas.slice(0, 1);
    const falta = usadas.findIndex((f) => !f.nombre.trim() || !f.escena.trim() || !f.guionA.trim() || !f.guionB.trim() || !f.foto);
    if (falta !== -1) {
      setEstado({ texto: `Falta completar el video ${falta + 1}: nombre, escena, guion A, guion B y la foto de la protagonista.`, error: true });
      return;
    }
    if (elementos.titulo) {
      const mal = usadas.findIndex((f) => f.lineas.slice(0, lineasTitulo).some((l) => !l.trim()));
      if (mal !== -1) {
        setEstado({ texto: `El video ${mal + 1} necesita las ${lineasTitulo} líneas del título.`, error: true });
        return;
      }
    }

    setOcupado(true);
    const supabase = createSupabaseBrowserClient();
    try {
      const jobs = [];
      for (const [i, f] of usadas.entries()) {
        setEstado({ texto: `Subiendo la foto ${i + 1} de ${usadas.length}…` });
        const framePath = `${tenantId}/ugc/${crypto.randomUUID()}/${storageSafeName(f.foto!.name)}`;
        const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(framePath, f.foto!);
        if (error) throw new Error(`no se pudo subir "${f.foto!.name}": ${error.message}`);
        jobs.push({
          nombre: f.nombre.trim(),
          escena: f.escena.trim(),
          guionA: normalizarGuionUgc(f.guionA),
          guionB: normalizarGuionUgc(f.guionB),
          framePath,
          model: "veo3.1-fast" as const,
          elementos: { ...elementos, titulo: elementos.titulo ? { ...elementos.titulo, lineas: f.lineas.slice(0, lineasTitulo).map((l) => l.trim()) } : null },
        });
      }
      setEstado({ texto: "Creando los videos…" });
      await createUgcJobsAction({ tenantId, ...(lote ? { batchNombre: `Lote ${new Date().toLocaleDateString("es-PE")}` } : {}), jobs });
      setFilas([filaVacia()]);
      setFormKey((k) => k + 1);
      setEstado({ texto: `Listo — ${jobs.length === 1 ? "el video quedó" : `${jobs.length} videos quedaron`} en cola. Sigue el avance abajo.` });
    } catch (err) {
      setEstado({ texto: err instanceof Error ? err.message : "Algo falló al crear los videos.", error: true });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-6" key={formKey}>
      {/* Modo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-btn border border-line p-0.5" role="group" aria-label="Modo de producción">
          {[
            { v: false, l: "Un video" },
            { v: true, l: "Lote" },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              aria-pressed={lote === o.v}
              onClick={() => setLote(o.v)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-200 ${lote === o.v ? "bg-surface-2 text-fg" : "text-fg-2 hover:text-fg"}`}
            >
              {o.l}
            </button>
          ))}
        </div>
        <Field id="ugc-modelo" label="Modelo" className="min-w-56">
          <select id="ugc-modelo" className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
            {UGC_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="-mt-3 text-xs text-fg-3">{UGC_MODELS.find((m) => m.id === model)?.detalle}</p>

      {/* Elementos */}
      <div>
        <span className={labelClass}>Elementos del video</span>
        <details className="group rounded-btn border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm text-fg">
            <span>{activos === 0 ? "Ninguno seleccionado" : `${activos} elemento${activos === 1 ? "" : "s"} seleccionado${activos === 1 ? "" : "s"}`}</span>
            <ChevronDown size={16} className="text-fg-3 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="space-y-4 border-t border-line p-3">
            {GRUPOS.map((g) => (
              <fieldset key={g.id} className="space-y-1.5">
                <legend className="eyebrow mb-1 text-fg-3">{g.titulo}</legend>
                {UGC_ELEMENTOS_CATALOGO.filter((el) => el.grupo === g.id).map((el) => (
                  <label key={el.clave} className="flex cursor-pointer items-start gap-2.5 rounded-btn p-1.5 hover:bg-surface-2/60">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--accent,#ff5a2b)]"
                      checked={estaActivo(el.clave, g.id)}
                      onChange={() => toggleElemento(el.clave, g.id)}
                    />
                    <span>
                      <span className="block text-sm text-fg">{el.etiqueta}</span>
                      <span className="block text-xs text-fg-3">{el.descripcion}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </details>

        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-fg-2">
          <input type="checkbox" className="mt-1" checked={elementos.zonaSegura} onChange={(e) => setElementos({ ...elementos, zonaSegura: e.target.checked })} />
          <span>
            Zona segura de Reels
            <span className="block text-xs text-fg-3">Elementos más chicos y hacia el centro (títulos al centro, precio y pills dentro del área que no tapan la cabecera ni el botón de Reels).</span>
          </span>
        </label>

        {/* Ajustes de los elementos elegidos (compartidos por todo el lote) */}
        {(elementos.cta || elementos.destello || elementos.titulo) && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {elementos.titulo && (
              <Field id="ugc-tit-dur" label="Duración del título (s)">
                <input
                  id="ugc-tit-dur"
                  type="number"
                  min={1}
                  max={6}
                  step={0.5}
                  className={inputClass}
                  value={elementos.tituloDuracion}
                  onChange={(e) => setElementos({ ...elementos, tituloDuracion: Number(e.target.value) || 3 })}
                />
              </Field>
            )}
            {elementos.cta && (
              <>
                <Field id="ugc-cta1" label="CTA — fila 1">
                  <input id="ugc-cta1" className={inputClass} maxLength={20} value={elementos.cta.linea1} onChange={(e) => setElementos({ ...elementos, cta: { ...elementos.cta!, linea1: e.target.value } })} />
                </Field>
                <Field id="ugc-cta2" label="CTA — fila 2">
                  <input id="ugc-cta2" className={inputClass} maxLength={20} value={elementos.cta.linea2} onChange={(e) => setElementos({ ...elementos, cta: { ...elementos.cta!, linea2: e.target.value } })} />
                </Field>
              </>
            )}
            {elementos.destello && (
              <Field id="ugc-paleta" label="Paleta del destello">
                <select id="ugc-paleta" className={selectClass} value={elementos.destello.paleta} onChange={(e) => setElementos({ ...elementos, destello: { paleta: e.target.value as never } })}>
                  {PALETAS_DESTELLO.map((p) => (
                    <option key={p} value={p}>
                      {p === "frio" ? "Fría (azules, aprobada)" : p === "calido" ? "Cálida" : "Blanca"}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        )}
      </div>

      {/* Videos */}
      {!lote ? (
        <div className="space-y-4">
          <FotoPicker file={filas[0]!.foto} onChange={(f) => setFila(filas[0]!.id, { foto: f })} />
          <Field id="ugc-nombre" label="Nombre del video" required>
            <input id="ugc-nombre" className={inputClass} value={filas[0]!.nombre} onChange={(e) => setFila(filas[0]!.id, { nombre: e.target.value })} placeholder="Ej. Mismo número desde el colegio" />
          </Field>
          <Field id="ugc-escena" label="Escena (en inglés, para el modelo)" hint="Dónde está y cómo se siente. Ej.: in her bedroom with photos on the wall, warm and nostalgic" required>
            <input id="ugc-escena" className={inputClass} value={filas[0]!.escena} onChange={(e) => setFila(filas[0]!.id, { escena: e.target.value })} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="ugc-ga" label={`Guion A — primer tramo (${palabras(filas[0]!.guionA)} palabras, ideal ≤ 20)`} required>
              <textarea id="ugc-ga" rows={4} className={textareaClass} maxLength={300} value={filas[0]!.guionA} onChange={(e) => setFila(filas[0]!.id, { guionA: e.target.value })} />
            </Field>
            <Field id="ugc-gb" label={`Guion B — extensión (${palabras(filas[0]!.guionB)} palabras, ideal ≤ 17)`} hint="Empieza con una palabra corta y prescindible (ej. “Y ahora…”): el arranque de la extensión puede recortarse. El precio se escribe solo como “treintaynueve con noventa”." required>
              <textarea id="ugc-gb" rows={4} className={textareaClass} maxLength={300} value={filas[0]!.guionB} onChange={(e) => setFila(filas[0]!.id, { guionB: e.target.value })} />
            </Field>
          </div>
          {elementos.titulo && (
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: lineasTitulo }).map((_, i) => (
                <Field key={i} id={`ugc-lt${i}`} label={`Título — línea ${i + 1}`} required>
                  <input id={`ugc-lt${i}`} className={inputClass} maxLength={40} value={filas[0]!.lineas[i]} onChange={(e) => setLinea(filas[0]!.id, i, e.target.value)} />
                </Field>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <details className="rounded-btn border border-line bg-surface">
            <summary className="cursor-pointer px-3 py-2 text-sm text-fg-2">Pegar una tabla (nombre ; escena ; guion A ; guion B ; línea 1 ; línea 2 ; línea 3)</summary>
            <div className="space-y-2 border-t border-line p-3">
              <textarea rows={5} className={textareaClass} value={pegar} onChange={(e) => setPegar(e.target.value)} placeholder="Una fila por video, columnas separadas por ; o tabulador. Las fotos se eligen después, fila por fila." />
              <Button type="button" variant="secondary" size="sm" onClick={importarTabla} disabled={!pegar.trim()}>
                Agregar filas
              </Button>
            </div>
          </details>

          <div className="space-y-3">
            {filas.map((f, i) => (
              <div key={f.id} className="space-y-3 rounded-btn border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow text-fg-3">Video {i + 1}</span>
                  {filas.length > 1 && (
                    <button type="button" aria-label={`Quitar el video ${i + 1}`} className="text-fg-3 hover:text-danger" onClick={() => setFilas((fs) => fs.filter((x) => x.id !== f.id))}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr]">
                  <FotoPicker compacto file={f.foto} onChange={(x) => setFila(f.id, { foto: x })} />
                  <input aria-label="Nombre" className={inputClass} placeholder="Nombre" value={f.nombre} onChange={(e) => setFila(f.id, { nombre: e.target.value })} />
                  <input aria-label="Escena en inglés" className={inputClass} placeholder="Escena (inglés): in her kitchen, confident" value={f.escena} onChange={(e) => setFila(f.id, { escena: e.target.value })} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <textarea aria-label="Guion A" rows={3} className={textareaClass} maxLength={300} placeholder={`Guion A — primer tramo (${palabras(f.guionA)} palabras)`} value={f.guionA} onChange={(e) => setFila(f.id, { guionA: e.target.value })} />
                  <textarea aria-label="Guion B" rows={3} className={textareaClass} maxLength={300} placeholder={`Guion B — extensión (${palabras(f.guionB)} palabras)`} value={f.guionB} onChange={(e) => setFila(f.id, { guionB: e.target.value })} />
                </div>
                {elementos.titulo && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {Array.from({ length: lineasTitulo }).map((_, k) => (
                      <input key={k} aria-label={`Título línea ${k + 1}`} className={inputClass} placeholder={`Título — línea ${k + 1}`} maxLength={40} value={f.lineas[k]} onChange={(e) => setLinea(f.id, k, e.target.value)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" disabled={filas.length >= 30} onClick={() => setFilas((fs) => [...fs, filaVacia()])}>
            <Plus size={14} aria-hidden="true" /> Agregar video
          </Button>
        </div>
      )}

      {/* Costo y envío */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-fg-2">
          {lote ? total : 1} video{(lote ? total : 1) === 1 ? "" : "s"} · costo estimado{" "}
          <span className="font-medium text-fg">≈ US${((lote ? total : 1) * UGC_COSTO_ESTIMADO_USD).toFixed(2)}</span> en APIMart
          <span className="text-fg-3"> · se cobra al generar; regenerar cuesta de nuevo</span>
        </p>
        <Button type="submit" pending={ocupado} pendingText="Creando…">
          <Wand2 size={16} aria-hidden="true" /> {lote ? "Generar lote" : "Generar video"}
        </Button>
      </div>
      {estado && (
        <p role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-danger" : "text-fg-2"}`}>
          {estado.texto}
        </p>
      )}
    </form>
  );
}
