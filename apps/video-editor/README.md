# @pulso/video-editor

Automatiza la edición de videos cortos a partir de tomas en crudo y un guion:
lee el guion, transcribe y analiza el audio, arma el corte, superpone
subtítulos y (Fase 2) título y música — todo en pasos independientes que
escriben su propio JSON, así que cambiar algo más adelante en el pipeline
(el preset, por ejemplo) no obliga a repetir lo anterior (transcribir de
nuevo, sobre todo, es lo más lento).

**Estado:** Fase 1 (núcleo del pipeline, sin UI). Ver `PLAN.md` — no existe
todavía, se agrega en Fase 4 — para el resto de fases. Esta es la versión
mínima que prueba que el pipeline entero funciona de punta a punta: ingesta →
guion → transcripción → alineación → EDL → render con subtítulos simples,
sin estilo de marca todavía (eso es Fase 2).

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
  --language es
```

También acepta `--videos-dir <carpeta>` en vez de `--videos` (usa todos los
`.mp4` que estén directamente dentro de esa carpeta), y `--force` para
reprocesar todo ignorando los artefactos ya guardados.

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
