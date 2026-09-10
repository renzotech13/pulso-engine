# @pulso/video-editor

Automatiza la edición de videos cortos a partir de tomas en crudo y un guion:
lee el guion, transcribe y analiza el audio, arma el corte, superpone título
y subtítulos con el estilo de marca, y mezcla música con ducking — todo en
pasos independientes que escriben su propio JSON, así que cambiar el preset
y volver a renderizar no obliga a repetir lo anterior (transcribir de nuevo,
sobre todo, es lo más lento).

**Estado:** Fase 2 (estilos, título y música) completa. Ver `PLAN.md` — no
existe todavía, se agrega en Fase 4 — para el resto de fases. Falta la
interfaz (las tres pantallas, Fase 3) y el trabajo de calidad final
(pruebas end-to-end automatizadas, este README completo — Fase 4); el
pipeline en sí ya cubre ingesta → guion → transcripción → alineación → EDL
→ título/subtítulos con estilo → música → render final.

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
