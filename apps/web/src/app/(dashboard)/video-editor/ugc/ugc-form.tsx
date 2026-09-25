"use client";

import { useRef, useState, type FormEvent } from "react";
import { ChevronDown, ImagePlus, Music, Plus, Trash2, Wand2 } from "lucide-react";
import {
  ELEMENTOS_POR_DEFECTO,
  PALETAS_DESTELLO,
  PRESETS,
  SITUACION_COSTO_ESTIMADO_USD,
  TIPOS_TOMA,
  UGC_COSTO_ESTIMADO_USD,
  COSTO_PRIMER_CUADRO_USD,
  UGC_ELEMENTOS_CATALOGO,
  VOCES_CONOCIDAS,
  normalizarGuionUgc,
  type PresetId,
  type TipoToma,
  type UgcElementos,
} from "@pulso/shared/ugc";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createUgcJobsAction } from "@/lib/ugc-actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass, labelClass, selectClass, textareaClass } from "@/components/ui/field";

const ASSETS_BUCKET = "video-editor-assets";
const storageSafeName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");
const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

interface TomaFila {
  escena: string;
  movimiento: string;
  tipo: TipoToma;
  otraPersona: boolean;
}

interface Fila {
  id: string;
  nombre: string;
  lineas: [string, string, string];
  // preset UGC
  escena: string;
  guionA: string;
  guionB: string;
  foto: File | null;
  ropa: string;
  // preset situación
  personaje: string;
  guion: string;
  vozModo: "conocida" | "id" | "audio";
  vozConocida: string;
  vozId: string;
  audio: File | null;
  velocidad: number; // en % (100 = tal cual, 110 = +10 %)
  colaSeg: number;
  tomas: TomaFila[];
}

const tomaVacia = (): TomaFila => ({ escena: "", movimiento: "", tipo: "normal", otraPersona: false });
const filaVacia = (): Fila => ({
  id: crypto.randomUUID(),
  nombre: "",
  lineas: ["", "", ""],
  escena: "",
  guionA: "",
  guionB: "",
  foto: null,
  ropa: "",
  personaje: "",
  guion: "",
  vozModo: "conocida",
  vozConocida: VOCES_CONOCIDAS[0].id,
  vozId: "",
  audio: null,
  velocidad: 100,
  colaSeg: 0.5,
  tomas: [tomaVacia(), tomaVacia(), tomaVacia(), tomaVacia()],
});

const GRUPOS: { id: string; titulo: string; soloUgc?: boolean }[] = [
  { id: "titulo", titulo: "Título inicial (3 s)" },
  { id: "precio", titulo: "Precio (siempre antes del CTA)" },
  { id: "cta", titulo: "CTA con flecha (arriba)" },
  { id: "whatsapp", titulo: "Pill de WhatsApp (abajo)" },
  { id: "destello", titulo: "Transición", soloUgc: true },
  { id: "subtitulos", titulo: "Subtítulos por palabra (elige uno)" },
];

function FotoPicker({ file, onChange, texto }: { file: File | null; onChange: (f: File | null) => void; texto?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-line-2 px-4 py-6 text-sm text-fg-2 hover:border-accent/60"
      >
        <ImagePlus size={18} aria-hidden="true" />
        <span className="truncate">{file ? file.name : (texto ?? "Elegir la foto de la protagonista (primer cuadro)")}</span>
      </button>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </>
  );
}

function AudioPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-line-2 px-4 py-3 text-sm text-fg-2 hover:border-accent/60"
      >
        <Music size={16} aria-hidden="true" />
        <span className="truncate">{file ? file.name : "Subir el audio ya generado (mp3, wav, m4a)"}</span>
      </button>
      <input ref={ref} type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a" className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </>
  );
}

export function UgcForm({ tenantId }: { tenantId: string }) {
  const [preset, setPreset] = useState<PresetId>("ugc");
  const [lote, setLote] = useState(false);
  const [filas, setFilas] = useState<Fila[]>([filaVacia()]);
  const [elementos, setElementos] = useState<UgcElementos>(ELEMENTOS_POR_DEFECTO);
  // UGC: el primer cuadro puede subirse ya hecho (por video) o generarse desde UNA foto de referencia compartida por todo el lote.
  const [frameModo, setFrameModo] = useState<"listo" | "referencia">("listo");
  const [referencia, setReferencia] = useState<File | null>(null);
  const [pegar, setPegar] = useState("");
  const [estado, setEstado] = useState<{ texto: string; error?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const esSit = preset === "situacion";
  const tituloDef = UGC_ELEMENTOS_CATALOGO.find((e) => e.clave === elementos.titulo?.clave);
  const lineasTitulo = tituloDef?.lineas ?? 0;
  const activos = [elementos.titulo, elementos.precio, elementos.cta, elementos.whatsapp || null, esSit ? null : elementos.destello, elementos.subtitulos].filter(Boolean).length;
  const visibles = lote ? filas : filas.slice(0, 1);
  const generaFrame = !esSit && frameModo === "referencia";
  const costoUnidad = esSit ? SITUACION_COSTO_ESTIMADO_USD : UGC_COSTO_ESTIMADO_USD + (generaFrame ? COSTO_PRIMER_CUADRO_USD : 0);

  const setFila = (id: string, patch: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const setLinea = (id: string, i: number, v: string) =>
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, lineas: f.lineas.map((l, k) => (k === i ? v : l)) as Fila["lineas"] } : f)));
  const setToma = (id: string, i: number, patch: Partial<TomaFila>) =>
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, tomas: f.tomas.map((t, k) => (k === i ? { ...t, ...patch } : t)) } : f)));

  function toggleElemento(clave: string, grupo: string) {
    setElementos((prev) => {
      const next = { ...prev };
      const activo =
        (grupo === "titulo" && prev.titulo?.clave === clave) ||
        (grupo === "precio" && prev.precio?.clave === clave) ||
        (grupo === "cta" && prev.cta !== null) ||
        (grupo === "whatsapp" && prev.whatsapp) ||
        (grupo === "destello" && prev.destello !== null) ||
        (grupo === "subtitulos" && prev.subtitulos?.estilo === clave);
      if (grupo === "subtitulos") {
        next.subtitulos = activo ? null : { estilo: clave as never, marca: prev.subtitulos?.marca ?? { texto: "", acento: "", colorAcento: "#E3B341" } };
      }
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
    if (grupo === "subtitulos") return elementos.subtitulos?.estilo === clave;
    return elementos.destello !== null;
  }

  /** Tabla pegada (solo UGC): nombre ; escena ; guion A ; guion B ; línea 1 ; línea 2 ; línea 3. Las fotos se eligen fila por fila. */
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

  function validar(f: Fila, n: number): string | null {
    const v = `video ${n}`;
    if (!f.nombre.trim()) return `Falta el nombre del ${v}.`;
    if (elementos.titulo && f.lineas.slice(0, lineasTitulo).some((l) => !l.trim())) return `El ${v} necesita las ${lineasTitulo} líneas del título.`;
    if (!esSit) {
      if (!f.escena.trim() || !f.guionA.trim() || !f.guionB.trim() || (!generaFrame && !f.foto)) return `Falta completar el ${v}: escena, guion A, guion B${generaFrame ? "" : " y la foto de la protagonista"}.`;
      return null;
    }
    if (f.personaje.trim().length < 5) return `El ${v} necesita la descripción del personaje.`;
    if (f.guion.trim().length < 20) return `El ${v} necesita el guion de la voz en off.`;
    if (f.vozModo === "id" && f.vozId.trim().length < 10) return `El ${v} necesita el ID de voz de ElevenLabs.`;
    if (f.vozModo === "audio" && !f.audio) return `El ${v} necesita el audio subido.`;
    const mala = f.tomas.findIndex((t) => t.escena.trim().length < 5 || t.movimiento.trim().length < 5);
    if (mala !== -1) return `El ${v} tiene incompleta la toma ${mala + 1} (escena y movimiento).`;
    return null;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    if (generaFrame && !referencia) {
      setEstado({ texto: "Sube la foto de referencia de la persona (o cambia a “Ya tengo el primer cuadro”).", error: true });
      return;
    }
    for (const [i, f] of visibles.entries()) {
      const err = validar(f, i + 1);
      if (err) {
        setEstado({ texto: err, error: true });
        return;
      }
    }

    setOcupado(true);
    const supabase = createSupabaseBrowserClient();
    const subir = async (file: File, carpeta: string) => {
      const p = `${tenantId}/${carpeta}/${crypto.randomUUID()}/${storageSafeName(file.name)}`;
      const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(p, file);
      if (error) throw new Error(`no se pudo subir "${file.name}": ${error.message}`);
      return p;
    };
    try {
      const jobs = [];
      // La referencia se sube UNA vez y la usan todos los videos del lote.
      const refPath = generaFrame && referencia ? await subir(referencia, "ugc-ref") : null;
      for (const [i, f] of visibles.entries()) {
        setEstado({ texto: `Preparando el video ${i + 1} de ${visibles.length}…` });
        const els = { ...elementos, titulo: elementos.titulo ? { ...elementos.titulo, lineas: f.lineas.slice(0, lineasTitulo).map((l) => l.trim()) } : null, destello: esSit ? null : elementos.destello };
        if (!esSit) {
          jobs.push({
            preset: "ugc" as const,
            nombre: f.nombre.trim(),
            escena: f.escena.trim(),
            guionA: normalizarGuionUgc(f.guionA),
            guionB: normalizarGuionUgc(f.guionB),
            ...(refPath ? { referenciaPath: refPath, ropa: f.ropa.trim() } : { framePath: await subir(f.foto!, "ugc") }),
            model: "veo3.1-fast" as const,
            elementos: els,
          });
        } else {
          const voz =
            f.vozModo === "audio"
              ? { origen: "audio" as const, audioPath: await subir(f.audio!, "voces") }
              : { origen: "elevenlabs" as const, voiceId: (f.vozModo === "id" ? f.vozId : f.vozConocida).trim() };
          jobs.push({
            preset: "situacion" as const,
            nombre: f.nombre.trim(),
            elementos: els,
            situacion: {
              personaje: f.personaje.trim(),
              guion: normalizarGuionUgc(f.guion),
              voz,
              velocidad: f.velocidad / 100,
              tomas: f.tomas.map((t) => ({ escena: t.escena.trim(), movimiento: t.movimiento.trim(), tipo: t.tipo, otraPersona: t.otraPersona })),
              colaSeg: f.colaSeg,
            },
          });
        }
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
      {/* Preset y modo */}
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Tipo de video">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={preset === p.id}
              onClick={() => {
                setPreset(p.id);
                setFilas([filaVacia()]);
              }}
              className={`rounded-btn border p-3 text-left transition-colors duration-200 ${preset === p.id ? "border-accent bg-accent/10" : "border-line hover:border-fg-3"}`}
            >
              <span className="block text-sm font-medium text-fg">
                {p.label}
                {p.id === "ugc" && <span className="ml-2 text-xs text-accent-ink">por defecto</span>}
              </span>
              <span className="block text-xs text-fg-3">{p.detalle}</span>
            </button>
          ))}
        </div>
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
        <p className="text-xs text-fg-3">
          {esSit
            ? "Modelos: gpt-image-2 (imágenes) + Seedance 1.0 Pro Fast 720p (video) · voz ElevenLabs v3 o tu audio · siempre salen dos versiones: 9:16 y 4:5, con zona segura."
            : "Modelo: Veo 3.1 fast · tramo de 8 s + extensión con destello · siempre salen dos versiones: 9:16 y 4:5, con zona segura."}
        </p>
      </div>

      {/* Elementos */}
      <div>
        <span className={labelClass}>Elementos del video</span>
        <details className="group rounded-btn border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm text-fg">
            <span>{activos === 0 ? "Ninguno seleccionado" : `${activos} elemento${activos === 1 ? "" : "s"} seleccionado${activos === 1 ? "" : "s"}`}</span>
            <ChevronDown size={16} className="text-fg-3 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="space-y-4 border-t border-line p-3">
            {GRUPOS.filter((g) => !(esSit && g.soloUgc)).map((g) => (
              <fieldset key={g.id} className="space-y-1.5">
                <legend className="eyebrow mb-1 text-fg-3">{g.titulo}</legend>
                {UGC_ELEMENTOS_CATALOGO.filter((el) => el.grupo === g.id).map((el) => (
                  <label key={el.clave} className="flex cursor-pointer items-start gap-2.5 rounded-btn p-1.5 hover:bg-surface-2/60">
                    <input type="checkbox" className="mt-1" checked={estaActivo(el.clave, g.id)} onChange={() => toggleElemento(el.clave, g.id)} />
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

        {elementos.subtitulos && (
          <div className="mt-3 space-y-2 rounded-btn border border-line p-3">
            <span className="text-xs text-fg-3">
              Los subtítulos se ubican en una franja central, entre el título y el precio, y muestran lo que dice la voz (el precio como “39,90”).
            </span>
            {elementos.subtitulos.estilo === "black-centro" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="sub-marca" label="Nombre de la marca (debajo)" hint="Ej. @movistarperu. Vacío = sin firma.">
                  <input id="sub-marca" className={inputClass} maxLength={40} value={elementos.subtitulos.marca.texto} onChange={(e) => setElementos({ ...elementos, subtitulos: { ...elementos.subtitulos!, marca: { ...elementos.subtitulos!.marca, texto: e.target.value } } })} />
                </Field>
                <Field id="sub-acento" label="Parte en color (opcional)" hint="Un trozo del nombre. Ej. movistar">
                  <input id="sub-acento" className={inputClass} maxLength={20} value={elementos.subtitulos.marca.acento} onChange={(e) => setElementos({ ...elementos, subtitulos: { ...elementos.subtitulos!, marca: { ...elementos.subtitulos!.marca, acento: e.target.value } } })} />
                </Field>
                <Field id="sub-color" label="Color de esa parte">
                  <input id="sub-color" type="color" className="h-10 w-full cursor-pointer rounded-btn border border-line bg-surface" value={elementos.subtitulos.marca.colorAcento} onChange={(e) => setElementos({ ...elementos, subtitulos: { ...elementos.subtitulos!, marca: { ...elementos.subtitulos!.marca, colorAcento: e.target.value } } })} />
                </Field>
              </div>
            ) : (
              <p className="text-xs text-fg-3">Este estilo no lleva nombre de marca.</p>
            )}
          </div>
        )}

        {(elementos.cta || (!esSit && elementos.destello) || elementos.titulo) && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {elementos.titulo && (
              <Field id="ugc-tit-dur" label="Duración del título (s)">
                <input id="ugc-tit-dur" type="number" min={1} max={6} step={0.5} className={inputClass} value={elementos.tituloDuracion} onChange={(e) => setElementos({ ...elementos, tituloDuracion: Number(e.target.value) || 3 })} />
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
            {!esSit && elementos.destello && (
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
      {!esSit && (
        <div className="space-y-3 rounded-btn border border-line p-3">
          <span className={labelClass}>Primer cuadro del video</span>
          <div className="inline-flex rounded-btn border border-line p-0.5" role="group" aria-label="Origen del primer cuadro">
            {[
              { v: "listo" as const, l: "Ya tengo el primer cuadro" },
              { v: "referencia" as const, l: "Generarlo desde una foto de referencia" },
            ].map((o) => (
              <button key={o.v} type="button" aria-pressed={frameModo === o.v} onClick={() => setFrameModo(o.v)} className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-200 ${frameModo === o.v ? "bg-surface-2 text-fg" : "text-fg-2 hover:text-fg"}`}>
                {o.l}
              </button>
            ))}
          </div>
          {generaFrame ? (
            <>
              <FotoPicker file={referencia} onChange={setReferencia} texto="Elegir la foto de referencia de la persona (una para todo el lote)" />
              <p className="text-xs text-fg-3">
                Se genera un primer cuadro por video con la misma persona (misma cara, pelo y accesorios) en la escena y ropa de cada uno, de hombros hacia arriba y sin manos. Suma ≈ US${COSTO_PRIMER_CUADRO_USD.toFixed(2)} por video; el primer cuadro generado queda guardado junto al video.
              </p>
            </>
          ) : (
            <p className="text-xs text-fg-3">Cada video usa la imagen que subas tal cual como primer cuadro: la persona ya en su escena, en vertical, de hombros hacia arriba y mirando a cámara.</p>
          )}
        </div>
      )}

      {!esSit && lote && (
        <details className="rounded-btn border border-line bg-surface">
          <summary className="cursor-pointer px-3 py-2 text-sm text-fg-2">Pegar una tabla (nombre ; escena ; guion A ; guion B ; línea 1 ; línea 2 ; línea 3)</summary>
          <div className="space-y-2 border-t border-line p-3">
            <textarea rows={5} className={textareaClass} value={pegar} onChange={(e) => setPegar(e.target.value)} placeholder="Una fila por video, columnas separadas por ; o tabulador. Las fotos se eligen después, fila por fila." />
            <Button type="button" variant="secondary" size="sm" onClick={importarTabla} disabled={!pegar.trim()}>
              Agregar filas
            </Button>
          </div>
        </details>
      )}

      <div className="space-y-4">
        {visibles.map((f, i) => (
          <div key={f.id} className={lote ? "space-y-4 rounded-btn border border-line p-3" : "space-y-4"}>
            {lote && (
              <div className="flex items-center justify-between gap-2">
                <span className="eyebrow text-fg-3">Video {i + 1}</span>
                {filas.length > 1 && (
                  <button type="button" aria-label={`Quitar el video ${i + 1}`} className="text-fg-3 hover:text-danger" onClick={() => setFilas((fs) => fs.filter((x) => x.id !== f.id))}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            <Field id={`n-${f.id}`} label="Nombre del video" required>
              <input id={`n-${f.id}`} className={inputClass} value={f.nombre} onChange={(e) => setFila(f.id, { nombre: e.target.value })} placeholder={esSit ? "Ej. Taxista sin datos" : "Ej. Mismo número desde el colegio"} />
            </Field>

            {!esSit ? (
              <>
                {generaFrame ? (
                  <Field id={`r-${f.id}`} label="Ropa de este video (en inglés, opcional)" hint="Ej.: a plain light-grey hoodie. Vacío = la misma ropa que en la referencia. La escena de abajo también cambia el fondo.">
                    <input id={`r-${f.id}`} className={inputClass} maxLength={200} value={f.ropa} onChange={(e) => setFila(f.id, { ropa: e.target.value })} />
                  </Field>
                ) : (
                  <FotoPicker file={f.foto} onChange={(x) => setFila(f.id, { foto: x })} />
                )}
                <Field id={`e-${f.id}`} label="Escena (en inglés, para el modelo)" hint="Dónde está y cómo se siente. Ej.: in her bedroom with photos on the wall, warm and nostalgic" required>
                  <input id={`e-${f.id}`} className={inputClass} value={f.escena} onChange={(e) => setFila(f.id, { escena: e.target.value })} />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field id={`ga-${f.id}`} label={`Guion A — primer tramo (${palabras(f.guionA)} palabras, ideal ≤ 20)`} required>
                    <textarea id={`ga-${f.id}`} rows={4} className={textareaClass} maxLength={300} value={f.guionA} onChange={(e) => setFila(f.id, { guionA: e.target.value })} />
                  </Field>
                  <Field id={`gb-${f.id}`} label={`Guion B — extensión (${palabras(f.guionB)} palabras, ideal ≤ 17)`} hint="Empieza con una palabra corta y prescindible (“Y ahora…”): el arranque de la extensión puede recortarse. El precio se reescribe solo a “treintaynueve con noventa”." required>
                    <textarea id={`gb-${f.id}`} rows={4} className={textareaClass} maxLength={300} value={f.guionB} onChange={(e) => setFila(f.id, { guionB: e.target.value })} />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field id={`p-${f.id}`} label="Personaje (en inglés)" hint="Ej.: a Peruvian woman in her 50s, hair tied back, apron, owner of a corner grocery store" required>
                  <input id={`p-${f.id}`} className={inputClass} value={f.personaje} onChange={(e) => setFila(f.id, { personaje: e.target.value })} />
                </Field>

                <Field id={`g-${f.id}`} label={`Guion de la voz en off (${palabras(f.guion)} palabras, ideal 35–45)`} hint="Con etiquetas de ElevenLabs v3: [worried], [upbeat], [excited], [warmly]… El precio se reescribe solo a “treintaynueve con noventa”. Si subes un audio propio, el texto solo sirve de referencia." required>
                  <textarea id={`g-${f.id}`} rows={5} className={textareaClass} maxLength={900} value={f.guion} onChange={(e) => setFila(f.id, { guion: e.target.value })} />
                </Field>

                <div className="space-y-3 rounded-btn border border-line p-3">
                  <span className={labelClass}>Voz en off</span>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field id={`vm-${f.id}`} label="Origen">
                      <select id={`vm-${f.id}`} className={selectClass} value={f.vozModo} onChange={(e) => setFila(f.id, { vozModo: e.target.value as Fila["vozModo"] })}>
                        <option value="conocida">Voz conocida</option>
                        <option value="id">Otro ID de ElevenLabs</option>
                        <option value="audio">Audio ya generado</option>
                      </select>
                    </Field>
                    {f.vozModo === "conocida" && (
                      <Field id={`vc-${f.id}`} label="Voz">
                        <select id={`vc-${f.id}`} className={selectClass} value={f.vozConocida} onChange={(e) => setFila(f.id, { vozConocida: e.target.value })}>
                          {VOCES_CONOCIDAS.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.nombre}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {f.vozModo === "id" && (
                      <Field id={`vi-${f.id}`} label="ID de voz (voice_id)">
                        <input id={`vi-${f.id}`} className={inputClass} maxLength={40} value={f.vozId} onChange={(e) => setFila(f.id, { vozId: e.target.value })} placeholder="Ej. aYQAm4rWuigkeuRA5i92" />
                      </Field>
                    )}
                    {f.vozModo === "audio" && (
                      <div className="sm:col-span-2 sm:pt-6">
                        <AudioPicker file={f.audio} onChange={(x) => setFila(f.id, { audio: x })} />
                      </div>
                    )}
                    <Field id={`vv-${f.id}`} label="Velocidad (%)" hint="110 = +10 % sin cambiar el tono">
                      <input id={`vv-${f.id}`} type="number" min={80} max={130} step={1} className={inputClass} value={f.velocidad} onChange={(e) => setFila(f.id, { velocidad: Number(e.target.value) || 100 })} />
                    </Field>
                  </div>
                  <Field id={`vt-${f.id}`} label="Segundos de cola tras la última palabra" hint="0.5 por defecto; 0 = termina justo al acabar la voz">
                    <input id={`vt-${f.id}`} type="number" min={0} max={2} step={0.05} className={`${inputClass} max-w-40`} value={f.colaSeg} onChange={(e) => setFila(f.id, { colaSeg: Math.max(0, Number(e.target.value) || 0) })} />
                  </Field>
                </div>

                <div className="space-y-3">
                  <span className={labelClass}>Las 4 tomas (se reparten según lo que dice la voz)</span>
                  {f.tomas.map((t, k) => (
                    <div key={k} className="space-y-2 rounded-btn border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-fg-3">Toma {k + 1}</span>
                        {k > 0 && (
                          <label className="flex items-center gap-1.5 text-xs text-fg-2">
                            <input type="checkbox" checked={t.otraPersona} onChange={(e) => setToma(f.id, k, { otraPersona: e.target.checked })} />
                            Es otra persona (no la de la toma 1)
                          </label>
                        )}
                      </div>
                      <input aria-label={`Escena de la toma ${k + 1}`} className={inputClass} placeholder="Qué se ve (inglés): behind the counter of her store arranging products…" maxLength={400} value={t.escena} onChange={(e) => setToma(f.id, k, { escena: e.target.value })} />
                      <input aria-label={`Movimiento de la toma ${k + 1}`} className={inputClass} placeholder="Movimiento (inglés): she arranges cans and turns to the camera; slow push-in" maxLength={300} value={t.movimiento} onChange={(e) => setToma(f.id, k, { movimiento: e.target.value })} />
                      <select aria-label={`Tipo de la toma ${k + 1}`} className={selectClass} value={t.tipo} onChange={(e) => setToma(f.id, k, { tipo: e.target.value as TipoToma })}>
                        {TIPOS_TOMA.map((tt) => (
                          <option key={tt.id} value={tt.id}>
                            {tt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <p className="text-xs text-fg-3">
                    Reglas automáticas: nunca se muestra dinero (monedas, billetes, recibos), nadie mueve los labios (es voz en off) y los celulares siguen el tipo de cada toma: de espaldas con funda de color y lentes, o de frente mostrando lo que se fotografía.
                  </p>
                </div>
              </>
            )}

            {elementos.titulo && (
              <div className="grid gap-3 sm:grid-cols-3">
                {Array.from({ length: lineasTitulo }).map((_, k) => (
                  <Field key={k} id={`lt-${f.id}-${k}`} label={`Título — línea ${k + 1}`} required>
                    <input id={`lt-${f.id}-${k}`} className={inputClass} maxLength={40} value={f.lineas[k]} onChange={(e) => setLinea(f.id, k, e.target.value)} />
                  </Field>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {lote && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={filas.length >= 30} onClick={() => setFilas((fs) => [...fs, filaVacia()])}>
            <Plus size={14} aria-hidden="true" /> Agregar video
          </Button>
          {esSit && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={filas.length >= 30}
              onClick={() => setFilas((fs) => [...fs, { ...fs[fs.length - 1]!, id: crypto.randomUUID(), nombre: "", audio: null }])}
            >
              Duplicar el último
            </Button>
          )}
        </div>
      )}

      {/* Costo y envío */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-fg-2">
          {visibles.length} video{visibles.length === 1 ? "" : "s"} · costo estimado <span className="font-medium text-fg">≈ US${(visibles.length * costoUnidad).toFixed(2)}</span> en APIMart
          <span className="text-fg-3">{esSit ? " (+ la voz en ElevenLabs si no subes audio)" : ""} · se cobra al generar; regenerar cuesta de nuevo</span>
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
