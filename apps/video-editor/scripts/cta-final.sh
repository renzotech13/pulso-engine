#!/bin/bash
# Pone el título CTA de 3 niveles (superior izq. script, medio grande, inferior der.) en los ÚLTIMOS N segundos de un video.
# Uso:  cta-final.sh ENTRADA.mp4 SALIDA.mp4 "línea superior | línea media | línea inferior" [segundos=3] [pos_y=0.6]
# Ej.:  cta-final.sh in.mp4 out.mp4 "escríbenos por | WhatsAPP | y empezamos hoy" 3
set -euo pipefail
IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; OUT="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
TEXTO="$3"; SEG="${4:-3}"; POSY="${5:-0.6}"
EDITOR="/Users/renzo/Pulso Engine/apps/video-editor"; PRESET="config/presets/cta-referencia-3-niveles.json"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
T=$(python3 -c "print(max(0.0, $D - $SEG))"); SEG_REAL=$(python3 -c "print(round($D - $T, 3))")
ENC=(-c:v libx264 -crf 15 -preset fast -c:a aac -ar 48000 -b:a 256k)
ffmpeg -v error -y -i "$IN" -t "$T" "${ENC[@]}" "$TMP/a.mp4"                    # tramo sin CTA
ffmpeg -v error -y -ss "$T" -i "$IN" "${ENC[@]}" "$TMP/b.mp4"                    # últimos N segundos
( cd "$EDITOR" && npx tsx src/titulo-cli.ts "$TMP/b.mp4" "$TMP/b_t.mp4" "$TEXTO" --preset "$PRESET" \
    --sombra on --llenar-medio on --ancho-maximo 0.88 --pos-y "$POSY" \
    --espacio-medio -30 --espacio-inferior -10 --duracion "$SEG_REAL" )
ffmpeg -v error -y -i "$TMP/a.mp4" -i "$TMP/b_t.mp4" -filter_complex \
  "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" \
  -c:v libx264 -crf 15 -preset fast -pix_fmt yuv420p -r 30 -c:a aac -ar 48000 -b:a 256k -movflags +faststart "$OUT"
echo "listo: $OUT (CTA en los últimos ${SEG_REAL}s)"
