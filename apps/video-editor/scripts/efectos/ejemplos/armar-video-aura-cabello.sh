D="/Users/renzo/aura edits/cabello/video-01"; A="$D/tomas de apoyo extras"; T="/Users/renzo/aura edits/cabello/_receta/textos"  # textos: generá los tuyos con texto-png.sh; fx: $HOME/.cache/pulso-flare/fx (ver flare-transicion.sh)
OUT="$D/video-01-LC709-C2002-esc2-C2272-C2265-textos-flare.mp4"; OFF=2521
LUT="/Users/renzo/Library/CloudStorage/GoogleDrive-amplificape@gmail.com/Mi unidad/SonyLookProfiles_SLog3_SGamut3Cine/1_SGamut3CineSLog3_To_LC-709.cube"
SLOG="fps=30,scale=in_range=pc:in_color_matrix=bt709:out_range=pc,format=gbrp16le,lutrgb=r=clip(val-${OFF}\,0\,maxval):g=clip(val-${OFF}\,0\,maxval):b=clip(val-${OFF}\,0\,maxval),lut3d=file='$LUT':interp=tetrahedral,scale=1080:1920:flags=lanczos+accurate_rnd:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p"
ffmpeg -y -v error -stats \
  -ss 0.75 -t 3.25 -i "$D/C2002.MP4" \
  -ss 15.00 -t 4.00 -i "$D/escena-02.MP4" \
  -ss 66.00 -t 4.00 -i "$D/C2272.MP4" \
  -ss 4.00 -t 3.50 -i "$A/C2265.MP4" \
  -loop 1 -framerate 30 -t 15 -i "$T/t1.png" \
  -loop 1 -framerate 30 -t 15 -i "$T/t2.png" \
  -framerate 30 -i "$T/../fx/f_%03d.png" \
  -filter_complex "[0:v]$SLOG[a];[1:v]$SLOG[b];[2:v]$SLOG[c];[3:v]$SLOG[d];
[a][b][c][d]concat=n=4:v=1:a=0[base];
[4:v]format=rgba,fade=t=in:st=2.0:d=0.25:alpha=1,fade=t=out:st=3.75:d=0.25:alpha=1[t1];
[5:v]format=rgba,fade=t=in:st=4.4:d=0.3:alpha=1,fade=t=out:st=8.1:d=0.3:alpha=1[t2];
[base][t1]overlay=0:0:format=auto[o1];[o1][t2]overlay=0:0:format=auto[vc];
[vc]split=3[q1][q2][q3];[q1]trim=0:6.65,setpts=PTS-STARTPTS[pre];[q2]trim=6.65:8.35,setpts=PTS-STARTPTS,scale=in_range=tv:in_color_matrix=bt709,format=gbrp[seg];[q3]trim=start=8.35,setpts=PTS-STARTPTS[post];
[6:v]format=gbrp,setsar=1[fxv];[seg][fxv]blend=all_mode=screen:shortest=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[segf];[pre][segf][post]concat=n=3:v=1:a=0[v];
[0:a]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=3.05:d=0.2[a0];anullsrc=r=48000:cl=stereo:d=12,atrim=0:12[a1];[a0][a1]concat=n=2:v=0:a=1[aud]" \
  -map "[v]" -map "[aud]" -frames:v 445 -t 14.8333 -c:v libx264 -crf 16 -preset medium -profile:v high -pix_fmt yuv420p -r 30 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a aac -b:a 192k -movflags +faststart "$OUT"
echo TERMINADO
