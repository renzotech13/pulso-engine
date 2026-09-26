---
name: efectos-video
description: Efectos y transiciones reutilizables para los videos verticales de cualquier cuenta (Aura, AZ, otras) — destello/light leak con whoosh sobre un corte, textos casuales con emoji, y entrega con copia ligera. Usar cuando el usuario pida una transición cinemática, flare, whoosh, texto con emoji o cualquier efecto sobre un video ya armado, sin importar la marca.
---

# Efectos de video (agnósticos de marca)

Carpeta: `apps/video-editor/scripts/efectos/` (README ahí). No pertenece a ninguna cuenta: los colores/fuente se parametrizan.
Para el color/corte específico de Aura ver la skill `editar-video-aura`; para AZ, la memoria `feedback-az-video-editing-rules`.

## Destello + whoosh en un corte
```bash
apps/video-editor/scripts/efectos/flare-transicion.sh entrada.mp4 salida.mp4 <segundo-del-corte> [--paleta calido|frio|blanco] [--sin-whoosh]
```
- El pico blanco cae exacto en el segundo del corte (0.6 s antes → 1.1 s después). Hace falta ese margen en el video.
- Paletas: `calido` (naranja/rosa/dorado; el aprobado en Aura), `frio` (azules; pensado para marcas azules como AZ), `blanco` (neutro).
  Otra paleta = agregar entrada a `PALETAS` en `genflare.py` (leaks, franja, núcleo, reflejos, deslumbre).
- Whoosh sintético: sube hasta el corte, golpe grave, brillo agudo, paneo izq→der; se mezcla con el audio del video (o crea la pista si no hay).
- Sobre el sonido: el pico queda ~10 dB por encima del ambiente; si el video lleva voz, bajar el whoosh (editar ganancia `0.55` al final de `genwhoosh.py`) o usar `--sin-whoosh`.
- Re-codifica el video (crf 16). Si se arma todo con ffmpeg en un solo paso, usar el destello dentro del mismo grafo
  (`trim` del segmento + `blend=all_mode=screen` con los PNG de `~/.cache/pulso-efectos/flare-<paleta>/f_%03d.png`; ver `ejemplos/`).
- Elegir bien el corte: cambio de escena o de plano (revelación, del proceso al resultado). Uno por video; más de uno cansa.

## Texto casual con emoji
```bash
[FUENTE=Georgia] [PESO=700] [COLOR=#fff] apps/video-editor/scripts/efectos/texto-png.sh "Frase 🙈" out.png [tamaño=66] [top=1500] [--dos-lineas]
```
PNG transparente 1080×1920 (Chrome headless: el emoji sale a color; `drawtext` de ffmpeg no sirve). Franja baja para no tapar rostros.
Superponer con `-loop 1 -framerate 30 -t <dur> -i png` + `fade=t=in/out:alpha=1` (st = segundo) + `overlay=0:0:format=auto`, entrada/salida 0.2–0.3 s.
Una línea (~27 caracteres + emoji a 66 px); si no cabe, `--dos-lineas`. Para la tipografía de marca usar `FUENTE`/`COLOR` (p. ej. AZ: azul `#BAE0FD`).
Los tiempos de cada texto los dicta el usuario en segundos exactos: respetarlos literal.

## Entrega
- El visor de la app no abre MP4 1080p de ~40 MB: enviar copia ligera (`scale=720:1280`, `-crf 22 -profile:v main`, ~5 MB) con `SendUserFile` y decir dónde está el original; si piden "el archivo completo", mandar el 1080p como adjunto (`display: attach`).
- Un archivo nuevo por iteración (`…-textos.mp4`, `…-flare.mp4`); nunca pisar versiones anteriores. Verificar con hoja de miniaturas antes de enviar.
- Trampas zsh/macOS: variables sin comillas no se separan en palabras; `sed -i ''`; glob sin coincidencias aborta; nada de cadenas con `sleep`.

## Elegir cortes: tramos estables de una toma
Cuando el usuario pida "las tomas estables", "sacar cortes de 2–5 s" o quitar el "cuadrar la toma" del inicio, usar
`apps/video-editor/scripts/efectos/tomas_estables.py` (ver README de esa carpeta): `python3 tomas_estables.py toma.mp4 --hoja --exportar carpeta`.
- Mide movimiento de CÁMARA (cuarto de bloques más quietos), no del sujeto. Sensibilidad `auto` por defecto: prueba estricto → normal → flexible.
- Devuelve `cámara estable desde` (fin del cuadrar), tramos con puntaje 0–1 y, si un tramo estable es largo, varios cortes de hasta 5 s.
- Es estabilidad de cámara, no de contenido: revisar siempre la hoja de contacto (`--hoja`) antes de usar los cortes. El usuario elige por contenido y a veces toma tramos con algo de movimiento (manos, pincel, revelado a mano).
- Para reajustar con nuevos ejemplos buenos: `--calibrar ejemplos/tramos-buenos-aura.json` (lista de {video, inicio, fin}).

## Movimiento suave (paneo) como "toma estable"
`python3 apps/video-editor/scripts/efectos/tomas_estables.py <video> --suave --min 1` añade la lista "movimiento suave":
tramos con desplazamiento sostenido hacia un lado (izquierda/derecha/arriba/abajo). Ver README de efectos. Zoom aún sin medir.
