#!/bin/bash
# Pone un título CTA de 3 niveles en los ÚLTIMOS N segundos de un video y lo sostiene hasta el último cuadro
# (sin animación de salida), con velo oscuro arriba. Lo llama `estilo cta <clave> ...`; no depende de ninguna marca:
# el preset y las banderas de titulo-cli vienen de la clave.
#   cta-sostenido.sh ENTRADA SALIDA "arriba | medio | abajo" SEGUNDOS POS_Y PRESET.json [banderas de titulo-cli...]
set -euo pipefail
IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; OUT="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
TEXTO="$3"; SEG="$4"; POSY="$5"; PRESET="$6"; shift 6
EDITOR="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
T=$(python3 -c "print(max(0.0, $D - $SEG))"); SEG_REAL=$(python3 -c "print(round($D - $T, 3))")
ENC=(-c:v libx264 -crf 15 -preset fast -c:a aac -ar 48000 -b:a 256k)
ffmpeg -v error -y -i "$IN" -t "$T" "${ENC[@]}" "$TMP/a.mp4"
ffmpeg -v error -y -ss "$T" -i "$IN" "${ENC[@]}" "$TMP/b.mp4"
ffmpeg -v error -y -f lavfi -i "color=c=black:s=1080x1920,format=rgba,geq=r='0':g='0':b='0':a='190*max(0\,1-Y/(H*0.7))'" -frames:v 1 "$TMP/scrim.png"
ffmpeg -v error -y -i "$TMP/b.mp4" -loop 1 -i "$TMP/scrim.png" -filter_complex "[1:v]format=rgba,fade=in:st=0:d=0.5:alpha=1[s];[0:v][s]overlay=0:0:shortest=1,format=yuv420p[v]" -map "[v]" -map 0:a -c:v libx264 -crf 15 -preset fast -c:a copy "$TMP/b_s.mp4" && mv "$TMP/b_s.mp4" "$TMP/b.mp4"
( cd "$EDITOR" && npx tsx src/titulo-cli.ts "$TMP/b.mp4" "$TMP/b_t.mp4" "$TEXTO" --preset "$PRESET" --pos-y "$POSY" "$@" \
    --duracion "$(python3 -c "print($SEG_REAL + 1.0)")" )
ffmpeg -v error -y -i "$TMP/a.mp4" -i "$TMP/b_t.mp4" -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" \
  -c:v libx264 -crf 15 -preset fast -pix_fmt yuv420p -r 30 -c:a aac -ar 48000 -b:a 256k -movflags +faststart "$OUT"
echo "listo: $OUT (CTA en los últimos ${SEG_REAL}s)"
