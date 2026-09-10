# @pulso/video-editor

Automatiza la edición de videos cortos a partir de tomas en crudo y un guion:
lee el guion, transcribe y analiza el audio, arma el corte, superpone título
y subtítulos con el estilo de marca, y mezcla música con ducking — todo en
pasos independientes que escriben su propio JSON, así que cambiar el preset
y volver a renderizar no obliga a repetir lo anterior (transcribir de nuevo,
sobre todo, es lo más lento).

**Estado:** Fase 3 (interfaz y jobs) completa. Falta el trabajo de calidad
final (Fase 4: pruebas end-to-end automatizadas, este README terminado).
El pipeline (Fases 1-2) es el mismo que corre desde la CLI o desde el
dashboard — solo cambia quién lo orquesta y dónde guarda sus resultados
(archivos locales para la CLI, Supabase para el dashboard). Ver
`src/db-pipeline.ts` para la versión que usa el dashboard.

## Requisitos

- **ffmpeg** (con soporte de `loudnorm`/`sidechaincompress`/`silencedetect` —
  la build de Homebrew ya los trae): `brew install ffmpeg`
- **whisper.cpp**: `brew install whisper-cpp` — instala el binario
  `whisper-cli`, pero NO un modelo. Descargá uno desde
  https://huggingface.co/ggerganov/whisper.cpp (`ggml-base.bin` alcanza para
  probar; `ggml-small.bin` o `ggml-medium.bin` dan mejor precisión en
  español a costa de más tiempo de proceso) y guardalo donde quieras.

## Variables de entorno

```
WHISPER_MODEL_PATH=/ruta/a/ggml-base.bin   # obligatorio
WHISPER_CLI_PATH=whisper-cli               # opcional, default "whisper-cli" (debe estar en el PATH)
```

## Uso

```bash
pnpm --filter @pulso/video-editor process \
  --videos toma1.mp4,toma2.mp4 \
  --pdf guiones.pdf \
  --out ./mi-proyecto \
  --preset config/presets/default.json \
  --music cancion.mp3 \
  --language es
```

También acepta `--videos-dir <carpeta>` en vez de `--videos` (usa todos los
`.mp4` que estén directamente dentro de esa carpeta), `--force` para
reprocesar todo ignorando los artefactos ya guardados, `--preset` (si se
omite, usa `config/presets/default.json`) y `--music` (opcional).

Cada corrida deja todo en `<out>/`:
- `artifacts/` — el JSON intermedio de cada paso (`script.json`,
  `audio/<archivo>.json`, `edl/<video>.json`, `subtitles/<video>.json`). Si
  ya existen, el paso correspondiente NO se repite — así se puede tocar el
  preset y volver a renderizar sin retranscribir.
- `output/<video>.mp4`, `.srt`, `.manifest.json` — uno por cada video que el
  PDF describe.

## Convención del PDF de guiones

El parser tolera formato libre, pero funciona mejor con encabezados
explícitos:

```
Video 1
Título: Formaliza tu negocio hoy
Hoy te explico cómo sacar tu RUC en Sunarp, paso a paso...

Video 2
Título: Evita esta multa
...
```

Si el documento no trae un PDF con capa de texto (una imagen escaneada), el
parser falla con un mensaje explícito — no hace OCR. Si el modelo local (LM
Studio) está corriendo, se usa para estructurar el documento; si no
responde o el documento no tiene encabezados reconocibles, cae a un parser
por encabezados que marca `necesitaRevision: true` en cualquier bloque
donde no haya podido confirmar el título.

## Cómo agregar otro proveedor de transcripción

`src/pipeline/transcription.ts` define la interfaz `TranscriptionProvider`
(un solo método, `transcribe(assetPath, language) -> TranscriptWord[]`).
`WhisperCppProvider` es la única implementación hoy; para agregar otra (una
API paga, por ejemplo) alcanza con otra clase que la implemente y cambiar
`getConfiguredProvider()` — nada más del pipeline necesita cambiar.

## Presets (línea gráfica)

Un preset es un JSON validado con Zod (`src/pipeline/preset.ts`) que define
tipografía, estilo de subtítulos (tamaño, colores, contorno, sombra, caja de
fondo, karaoke, mayúsculas, agrupación por palabras, ajuste de línea),
título (modo superpuesto o tarjeta, duración, animación) y salida (formato,
resolución, fps, calidad). `config/presets/default.json` es el que se usa
si no se pasa `--preset`. Ninguna propiedad del esquema de referencia queda
sin soporte: al elegir Remotion en vez de subtítulos quemados con ASS (ver
la decisión de Fase 0), esquinas redondeadas, sombras y resaltado por
palabra son CSS nativo. Lo único que se degrada explícitamente (nunca en
silencio: queda un `console.warn` con el motivo) es una animación no
reconocida — hoy solo existen `"pop"` para subtítulos y `"fadeIn"/"fadeOut"`
para el título.

Cambiar el preset y volver a renderizar no requiere retranscribir ni
realinear: `pnpm --filter @pulso/video-editor process ... --preset otro.json`
reutiliza `artifacts/audio/` y `artifacts/edl/` tal cual y solo rehace el
render final.

## Música (2.7)

Con `--music`, la voz se normaliza con `loudnorm` (-14 LUFS por defecto,
configurable en `preset.musica`) y la música se mezcla debajo con ducking
real (`sidechaincompress`: el volumen de la música baja cuando hay voz, no
un volumen fijo más bajo todo el tiempo) más fade-in/fade-out. Sin
`--music`, igual se aplica el `loudnorm` — "audio normalizado" no depende
de que haya musicalización.

## El dashboard (Fase 3)

Tres pantallas en `apps/web`, bajo `/video-editor`: **Nuevo proyecto** (sube
videos/PDF/música directo del navegador a Storage — un Server Action no
aguanta archivos de varios GB), **Revisión** (guion asignado, título on/off,
lista de segmentos con inicio/fin editables y opción de excluir, bloques de
subtítulos editables con los de baja confianza marcados) y **Resultados**
(descarga MP4/SRT, re-renderizar con otro preset).

**Cómo arranca el trabajo pesado:** el dashboard nunca toca Redis/BullMQ
directamente — llama una función RPC de Postgres
(`request_video_project_processing`, `request_video_render`) que inserta un
evento en la tabla `events`, el mismo outbox que ya usa el resto de Pulso
Engine. El dispatcher que YA corre dentro de `apps/workers`
(`src/dispatcher.ts`) enruta ese evento a la cola `video-editor` de BullMQ
sin cambios — no hace falta un segundo poller. Este paquete solo corre su
propio *worker* (`src/main.ts`, `pnpm --filter @pulso/video-editor dev`),
consumiendo esa cola, como un servicio local más (launchd), igual que
`apps/workers`/`apps/render-templates`.

**Dos eventos, dos trabajos:**
- `video.project.requested` → `processProjectJob` (2.1-2.4): descarga el
  PDF y las tomas desde Storage, valida, transcribe, alinea, y deja un
  `video_project_video` por cada video que el guion describe, en
  `en_revision`.
- `video.render.requested` → `renderVideoJob` (2.5-2.8): vuelve a descargar
  solo lo que la EDL (ya editada en Revisión, si hiciera falta) todavía
  referencia, y renderiza — nunca retranscribe.

**Storage:** dos buckets privados, `video-editor-assets` (crudo: videos,
PDF, música) y `video-editor-output` (render final + `.srt`). Privados
porque el material sin editar o sin aprobar no tiene por qué quedar
accesible por una URL pública adivinable, a diferencia de `product-media`/
`creative-assets` — toda lectura pasa por una URL firmada de corta duración
que el dashboard genera al momento de mostrar la página.

**Presets desde el dashboard:** `video_presets` sigue el mismo patrón
`tenant_id null = global` que `render_templates`. Corré
`pnpm --filter @pulso/video-editor seed-preset` una vez (después de aplicar
la migración) para cargar `config/presets/default.json` como preset global.

**Límite conocido:** la subida usa `supabase.storage.upload()` directo, sin
reanudación — el tamaño máximo de archivo lo define el límite del proyecto
de Supabase (no es ilimitado). Migrar a subida reanudable (TUS) queda para
cuando haga falta con material real.
