#!/usr/bin/env bash
# PNG transparente 1080x1920 con un texto casual (emoji a color) para superponer con ffmpeg.
#   [FUENTE=Georgia] [PESO=700] [COLOR=#fff] texto-png.sh "Ups… se me cayó el peine 🙈" salida.png [tamano-px=66] [top-px=1500] [--dos-lineas]
# Por defecto Georgia 700 blanca con sombra suave (FUENTE/PESO/COLOR la cambian por marca), centrada en la franja baja del cuadro (no tapa rostros).
# Una sola línea por defecto (bajá el tamaño si no cabe); --dos-lineas deja que el texto se parta.
set -euo pipefail
TXT="${1:?}"; OUT="${2:?}"; SZ="${3:-66}"; TOP="${4:-1500}"; WRAP="nowrap"; PAD=30
[ "${5:-}" = "--dos-lineas" ] && { WRAP="normal"; PAD=90; }
H="$(mktemp -t texto).html"
cat > "$H" <<HTML
<html><body style="margin:0;width:1080px;height:1920px;background:transparent;overflow:hidden">
<div style="position:absolute;left:${PAD}px;right:${PAD}px;top:${TOP}px;height:230px;display:flex;align-items:center;justify-content:center;text-align:center;
font-family:'${FUENTE:-Georgia}',serif;font-weight:${PESO:-700};font-size:${SZ}px;line-height:1.18;color:${COLOR:-#fff};white-space:${WRAP};
text-shadow:0 0 3px rgba(0,0,0,.85),0 3px 6px rgba(0,0,0,.6),0 6px 22px rgba(0,0,0,.55)">${TXT}</div></body></html>
HTML
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --default-background-color=00000000 --window-size=1080,1920 --screenshot="$OUT" "file://$H" >/dev/null 2>&1
rm -f "$H"; echo "PNG: $OUT"
# En ffmpeg: -loop 1 -framerate 30 -t 15 -i texto.png  y luego
#   [n:v]format=rgba,fade=t=in:st=<ini>:d=0.25:alpha=1,fade=t=out:st=<fin-0.25>:d=0.25:alpha=1[t];[base][t]overlay=0:0:format=auto
