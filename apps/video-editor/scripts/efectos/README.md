# efectos — transiciones, sonidos y textos reutilizables (todas las cuentas)

Herramientas de post-producción para los videos verticales (1080×1920) de cualquier cuenta (Aura, AZ, otras).
Nada aquí es de una marca: los colores, la fuente y el momento se pasan como parámetros.
Requisitos: ffmpeg, Python 3 con `numpy` y `Pillow`, Google Chrome (solo para los textos).

| Herramienta | Qué hace |
|---|---|
| `flare-transicion.sh` | Destello (light leak + franja anamórfica + deslumbre) con whoosh sobre un corte, con el pico exacto en el segundo indicado |
| `genflare.py` | Genera los 51 fotogramas del destello (paletas `calido`, `frio`, `blanco`; agregar una = una entrada en `PALETAS`) |
| `genwhoosh.py` | Sintetiza el whoosh (1.7 s) calzado con el destello |
| `texto-png.sh` | PNG transparente con un texto casual y emoji a color (fuente/peso/color por variables) |
| `tomas_estables.py` | Encuentra los tramos ESTABLES de un video (cámara ya quieta, sin el "cuadrar la toma" del inicio) y saca cortes de 2–5 s; sensibilidad automática, hoja de contacto, gráfico y exportación |
| `ejemplos/` | Un ensamblado completo real (video-01 de Aura: LUT, cortes, textos, destello dentro del mismo grafo) |

## Uso rápido
```bash
# destello + whoosh en el segundo 7.25 (paleta cálida por defecto)
./flare-transicion.sh entrada.mp4 salida.mp4 7.25
# paleta fría, sin sonido
./flare-transicion.sh entrada.mp4 salida.mp4 7.25 --paleta frio --sin-whoosh
# texto para superponer (marca AZ: azul claro)
COLOR="#BAE0FD" ./texto-png.sh "Ups… 🙈" texto.png 66 1500
```
El video necesita ≥0.6 s antes y ≥1.1 s después del corte.
Guía completa y criterios de uso: skill `efectos-video` (`.claude/skills/efectos-video/SKILL.md`).

## Tramos estables (`tomas_estables.py`)
```bash
python3 tomas_estables.py toma.mp4 [otra.mp4 ...] [--min 2 --max 5] [--sens auto|estricto|normal|flexible] [--hoja] [--grafico] [--exportar carpeta] [--json salida.json]
python3 tomas_estables.py --calibrar ejemplos/tramos-buenos-aura.json   # recalibra con tramos que TÚ diste por buenos
```
Mide el movimiento de la CÁMARA (no del sujeto) con correlación de fase por bloques y toma el cuarto de bloques más quieto: si la cámara
se mueve, todo el cuadro se mueve; si solo se mueve una mano o una persona, el fondo queda quieto. Devuelve tramos {inicio, fin, puntaje}
y "cámara estable desde": el segundo en que termina el cuadrar la toma. Un tramo estable largo se reparte en varios cortes de hasta `--max` s.
Análisis ≈ 1 s de cómputo por segundo de video 4K (queda en caché `~/.cache/tomas-estables`, ajustar umbrales después es instantáneo).
Calibración (17 tramos elegidos por el usuario, 3 proyectos): trípode/gimbal → 100 % con `normal`; cámara en mano con manos moviéndose necesita `flexible`
(`auto` elige el más estricto que aún rinde). Limitación: mide estabilidad de cámara, no calidad de contenido; foco y exposición no se usan (cambian con la escena).

### Movimiento suave (paneo lado a lado / vertical) — `tomas_estables.py --suave`
Para el usuario "estable" también es un paneo o zoom lento y sutil, no solo cámara quieta. `--suave` lista tramos donde el
cuadro completo (correlación de fase, cuadro entero) se desplaza SIEMPRE hacia el mismo lado durante ~1.5 s
(consistencia = |suma|/suma de |pasos| ≥ 0.70, velocidad 8–60 %/s del ancho); ida y vuelta salen como tramos separados.
Lo erratico ("cuadrando", temblor) cambia de signo cada pocos cuadros → consistencia < 0.3. Referencia: `C2263.MP4`
(paneo derecha 7.0–9.2 s y regreso 8.6–11 s). Limitaciones: el zoom in/out todavía NO se mide; en órbitas con paralaje
el desplazamiento lo domina el sujeto; los umbrales (`SUAVE`) salen de un solo ejemplo, ajustar con más clips.

### Paneo A→B — `tomas_estables.py --paneos` (regla del usuario, 2026-09-25)
Si la toma tiene un paneo de un lado al otro (aunque dure 0.7–2 s) ese es el corte: empieza cuando el cuadro deja de estar
quieto y TERMINA cuando la cámara llega a B; se usa solo el primero por toma (el regreso B→A se descarta). Detección: velocidad
del cuadro completo (30 fps) con hold previo ≥0.4 s bajo 20 %/s, ráfaga ≥20 %/s (pico ≥30), 0.4–2.5 s, un solo sentido, ≥25 % del
ancho, margen interno 0.07 s. Validado: C2263 → 8.00–8.73 s vs 8.017–8.734 s del usuario. Ejemplos exactos en
`ejemplos/tramos-usuario-exactos.json`. Pendiente: tomas de cámara fija con acción (C2230), que el usuario elige por contenido
(manos/cabello trabajando) — necesita más ejemplos etiquetados de las 30 tomas.

### Fases de cámara — `tomas_estables.py --fases` (2026-09-25)
Trayectoria robusta (puntos de fondo + RANSAC, traslación y zoom por cuadro a 30 fps; ignora manos/cabello que entran) →
lista de MOVIMIENTOS (forma diagonal/lateral/vertical, zoom acerca/aleja, confianza, llegada) y QUIETAS. Un movimiento nace con
pico ≥40 %/s y se extiende mientras ≥20 %/s; los valles cortos lo parten (la llegada a B es el valle). Lecturas lentas y poco
fiables (inliers <0.28) se descartan porque son manos, no cámara. Validado con lo que el usuario rescató:
C2263 8.00–8.73 = paneo (exacto vs 8;01–8;44); C2230 0.77–1.90 diagonal + 2.23–3.53 regreso con zoom-in (el usuario toma 1;14–3;46,
±0.25 s) y 4.97–6.23 quieta (usuario 4;51–6;04, ±0.15 s). Aún NO decide cuál fase tomar: el usuario toma la 1ª diagonal+regreso y la
quieta posterior en C2230, pero el 1er paneo de C2263 y no el regreso; falta la regla de selección (más tomas etiquetadas).
