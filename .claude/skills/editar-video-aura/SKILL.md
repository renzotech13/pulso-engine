---
name: editar-video-aura
description: Receta aprobada para editar los videos de cabello de Aura Studio (tomas Sony S-Log3 + HDR iPhone): cortes exactos, LUT LC-709 a -0.5 stop, escena rubia, textos casuales con emoji, audio y estilo de Aura. Usar cuando el usuario pida editar, unir tomas o poner LUT en videos de Aura / cabello. Los efectos (destello, whoosh, textos) y la entrega están en la skill efectos-video.
---

# Editar videos de cabello de Aura (receta aprobada, video-01, 2026-09-21)

Solo lo específico de Aura. Efectos reutilizables (destello + whoosh, textos con emoji, entrega con copia ligera) → skill `efectos-video`
y `apps/video-editor/scripts/efectos/` (sirven para cualquier cuenta). Ejemplo completo de ensamblado:
`apps/video-editor/scripts/efectos/ejemplos/armar-video-aura-cabello.sh`.
Material y salidas: `/Users/renzo/aura edits/cabello/video-01/` (respaldo de la receta en `.../cabello/_receta/`).

## Estilo aprobado de Aura
- Look: LC-709 a −0.5 stop (abajo), escena HDR con curva rubia, sin música, ambiente solo en la primera toma.
- Destello con paleta `calido` (la aprobada), UN destello en la revelación / paso del proceso al resultado, whoosh incluido.
- Textos: Georgia 700 blanca (default de `texto-png.sh`), frases casuales con emoji; el usuario da los segundos exactos.
- Formato: 1080×1920, 30 fps, H.264 crf 16, bt709/tv, AAC 192k, faststart.

## Color
- Tomas S-Log3 (Sony, `pix_fmt yuv422p10le`, rango pc, HEVC 4K, rotación -90 automática): decodificar con
  `scale=in_range=pc:in_color_matrix=bt709:out_range=pc,format=gbrp16le`, bajar exposición ANTES del LUT con
  `lutrgb=r=clip(val-2521\,0\,maxval):g=...:b=...` (−0.5 stop; 1 stop S-Log3 ≈ 5043 en 16 bits), luego
  `lut3d=file=<LC-709.cube>:interp=tetrahedral`, `scale=1080:1920:flags=lanczos+accurate_rnd:out_color_matrix=bt709:out_range=tv`.
  LUT: `1_SGamut3CineSLog3_To_LC-709.cube` en Drive `Mi unidad/SonyLookProfiles_SLog3_SGamut3Cine/`
  (el usuario ELIGIÓ LC-709 sobre TypeA, SLog2-709 y Cine+709, que quema a amarillo). Sony LUTs son "full in / full out".
- iPhone HDR (HLG BT.2020): `colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:irange=tv:fast=0:format=yuv420p`
  (no hay zscale; `iall=bt2020nc` da error). Si el cabello sale oscuro: pasar a `gbrp` (con `scale=in_range=tv:in_color_matrix=bt709`),
  `curves=master='0/0 0.25/0.36 0.5/0.63 0.75/0.85 1/1'` + `colorbalance=rs=.03:gs=.01:bs=-.08:rm=.09:gm=.05:bm=-.16:rh=.03:gh=.03:bh=-.06`
  (la variante intermedia; más fuerte lava piel y pared).
- Para comparar looks usar PNG o `format=rgb24` (JPEG de YUV limitado se ve lavado).

## Cortes y audio
- Ubicar "acción"/"grabando" con RMS de ventanas de 50 ms, no con Whisper (alucina "Gracias", "¡Suscríbete!" sobre ruido y
  desplaza tiempos). Whisper sirve para saber QUÉ se dice (`whisper-cli -m apps/video-editor/models/ggml-small.bin -l es -ml 1 -sow`).
- Los tiempos los dicta el usuario en segundos concretos ("de 1:06 a 1:10", "hasta el segundo 4"): usar `-ss/-t` exactos y respetarlos literal.
- Sin música salvo que la pida (probó Upbeat Corporate y The Holiday de Descargas, no eligió). Audio: solo el ambiente de la 1.ª toma
  con `afade` de salida; el resto silencio (`anullsrc` + `concat a=1`).
- Si se copia video (`-c:v copy`) cortar por `-frames:v N`, no por `-t` (se cuelan fotogramas del siguiente clip).
- Comprobar siempre con hoja de miniaturas (`fps=…,tile=Nx1`) antes de enviar.
