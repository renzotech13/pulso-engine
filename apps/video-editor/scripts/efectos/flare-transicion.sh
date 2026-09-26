#!/usr/bin/env bash
# Pone la transición "destello + whoosh" sobre un corte de un video YA armado.
#   flare-transicion.sh <entrada.mp4> <salida.mp4> <segundo-del-corte> [--paleta calido|frio|blanco] [--sin-whoosh]
# El pico blanco cae EXACTO en <segundo-del-corte>: el destello empieza 0.6 s antes y se
# apaga 1.1 s después, sobre la toma siguiente. Cualquier resolución/fps (usa el tamaño del video).
# Paletas: calido (naranja/rosa/dorado, default) | frio (azules) | blanco (neutro).
# Destello y whoosh se generan una sola vez por paleta (caché en ~/.cache/pulso-efectos).
# Re-codifica el video (crf 16). Si armás el video con ffmpeg, mirá ejemplos/ y metelo en el
# MISMO grafo para no perder una generación.
set -euo pipefail
IN="${1:?uso: flare-transicion.sh entrada.mp4 salida.mp4 segundo-del-corte [--paleta calido|frio|blanco] [--sin-whoosh]}"; OUT="${2:?}"; T="${3:?}"; shift 3
WHOOSH=1; PAL=calido
while [ $# -gt 0 ]; do case "$1" in --sin-whoosh) WHOOSH=0;; --paleta) PAL="${2:?}"; shift;; *) echo "opción desconocida: $1"; exit 1;; esac; shift; done
HERE="$(cd "$(dirname "$0")" && pwd)"; CACHE="${HOME}/.cache/pulso-efectos"
[ -f "$CACHE/flare-$PAL/f_050.png" ] || python3 "$HERE/genflare.py" "$CACHE/flare-$PAL" "$PAL"
[ -f "$CACHE/whoosh.wav" ]           || python3 "$HERE/genwhoosh.py" "$CACHE/whoosh.wav"

eval "$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of default=nw=1 "$IN" | sed 's/^width=/W=/;s/^height=/H=/;s/^r_frame_rate=/FR=/')" 
FPS=$(python3 -c "n,d='$FR'.split('/');print(round(int(n)/int(d),3))")
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
HAS_A=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$IN" | head -1)
S=$(python3 -c "print(round($T-0.6,3))"); E=$(python3 -c "print(round($T+1.1,3))")
python3 -c "import sys; sys.exit(0 if $S>0.05 and $E<$DUR else 1)" || { echo "el corte en $T s no deja 0.6 s antes / 1.1 s después (duración $DUR s)"; exit 1; }

VF="[0:v]split=3[q1][q2][q3];
[q1]trim=0:$S,setpts=PTS-STARTPTS[pre];
[q2]trim=$S:$E,setpts=PTS-STARTPTS,scale=in_range=tv:in_color_matrix=bt709,format=gbrp[seg];
[q3]trim=start=$E,setpts=PTS-STARTPTS[post];
[1:v]fps=$FPS,scale=$W:$H:flags=bicubic,format=gbrp,setsar=1[fxv];
[seg][fxv]blend=all_mode=screen:shortest=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[segf];
[pre][segf][post]concat=n=3:v=1:a=0[v]"
MS=$(python3 -c "print(int($S*1000))")
if [ "$WHOOSH" = 1 ]; then
  if [ -n "$HAS_A" ]; then AF="[0:a]aformat=sample_rates=48000:channel_layouts=stereo[o];[2:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=$MS|$MS[w];[o][w]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[aud]"
  else AF="[2:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=$MS|$MS,apad=whole_dur=$DUR[aud]"; fi
  ffmpeg -y -v error -stats -i "$IN" -framerate 30 -i "$CACHE/flare-$PAL/f_%03d.png" -i "$CACHE/whoosh.wav" \
    -filter_complex "$VF;$AF" -map "[v]" -map "[aud]" -t "$DUR" -c:v libx264 -crf 16 -preset medium -profile:v high -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a aac -b:a 192k -movflags +faststart "$OUT"
else
  ffmpeg -y -v error -stats -i "$IN" -framerate 30 -i "$CACHE/flare-$PAL/f_%03d.png" \
    -filter_complex "$VF" -map "[v]" ${HAS_A:+-map 0:a -c:a copy} -t "$DUR" -c:v libx264 -crf 16 -preset medium -profile:v high -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart "$OUT"
fi
echo "LISTO: $OUT (destello con pico en ${T}s)"
