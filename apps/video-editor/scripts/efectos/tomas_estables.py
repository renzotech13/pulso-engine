#!/usr/bin/env python3
"""tomas_estables — encuentra los tramos ESTABLES de un video (la cámara ya está quieta) para sacar cortes de 2–5 s.

Problema que resuelve: al empezar a grabar se "cuadra" la toma (la cámara se mueve, se ajusta el foco o la exposición) y
recién después queda el plano bueno. Esta herramienta mide, cuadro a cuadro, qué tanto se mueve LA CÁMARA (no el sujeto)
y devuelve solo los tramos donde ya está estable.

Cómo mide (todo sobre una copia reducida del video, ~10 cuadros/s):
  · movimiento de cámara: correlación de fase por bloques (rejilla 3×3) y MEDIANA entre bloques. Si el sujeto (manos, pincel,
    una persona) se mueve solo en parte del cuadro, la mediana lo ignora y solo cuenta lo que se mueve TODO el cuadro.
  · deriva: desplazamiento acumulado en 1 s (detecta paneos lentos que la velocidad sola no ve).
  · foco: varianza del Laplaciano relativa (detecta el autofoco "buscando").
  · exposición: cambio de luminosidad media (detecta el auto-ajuste de exposición).

Uso:
  tomas_estables.py VIDEO [VIDEO...] [--min 2] [--max 5] [--sens normal|estricto|flexible] [--json salida.json]
                    [--exportar CARPETA] [--hoja] [--grafico]
  tomas_estables.py --calibrar positivos.json     (ajusta los umbrales con tramos que TÚ marcaste como buenos)

Salida por video: lista de tramos {inicio, fin, duracion, puntaje}; el puntaje va de 0 a 1 (1 = clavado, sin nada de movimiento).
Requiere: ffmpeg, numpy, opencv-python (cv2).
"""
import argparse, hashlib, json, math, os, pickle, subprocess, sys
import numpy as np
import cv2

FPS_ANALISIS = 10
ANCHO = 288           # el lado corto del cuadro (tras autorotar) se lleva a 256 px para el análisis

# Umbrales por sensibilidad, calibrados con los tramos que el usuario dio por buenos (17 tramos, 3 proyectos):
#   vmed  = velocidad MEDIANA de la cámara en la ventana de 1 s (% del ancho por segundo). Trípode ≈ 0.1–2; a mano ≈ 3–15.
#   vpico = percentil 85 de la velocidad en la ventana (tolera un tirón corto, no varios).
#   deriva = desplazamiento neto en 1 s (% del ancho): atrapa los paneos lentos que la velocidad sola no ve.
#   foco/luz solo descartan casos extremos (autofoco buscando, cambio brusco de exposición); en el resto de casos cambian
#   con lo que ocurre en la escena y NO sirven para decidir si la cámara está quieta.
PERFILES = {
    "estricto": dict(vmed=1.2, vpico=3.0,  deriva=1.0,  foco=3.0, luz=60),   # trípode / gimbal quieto
    "normal":   dict(vmed=4.0, vpico=12.0, deriva=4.0,  foco=3.0, luz=60),   # lo que suele usarse en un corte
    "flexible": dict(vmed=9.0, vpico=25.0, deriva=10.0, foco=3.5, luz=70),   # cámara en mano bastante quieta
}


def leer_gris(ruta, fps=FPS_ANALISIS):
    """Decodifica el video a cuadros en gris reducidos. ffmpeg aplica la rotación (verticales) solo."""
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                           "stream=width,height:stream_side_data=rotation", "-of", "json", ruta],
                          capture_output=True, text=True).stdout
    j = json.loads(info)["streams"][0]
    w, h = j["width"], j["height"]
    rot = 0
    for sd in j.get("side_data_list", []):
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        w, h = h, w
    # el lado más corto pasa a ANCHO px
    if w <= h:
        ow, oh = ANCHO, int(round(h * ANCHO / w / 2) * 2)
    else:
        oh, ow = ANCHO, int(round(w * ANCHO / h / 2) * 2)
    cmd = ["ffmpeg", "-v", "error", "-i", ruta, "-an", "-vf",
           f"fps={fps},scale={ow}:{oh}:flags=fast_bilinear,format=gray", "-f", "rawvideo", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = ow * oh
    frames = []
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        frames.append(np.frombuffer(b, np.uint8).reshape(oh, ow))
    p.wait()
    return frames, ow, oh


def _normalizar(g):
    """La grabación en log (S-Log3) sale plana: se estira el contraste para que la correlación tenga de dónde agarrarse."""
    g = g.astype(np.float32)
    lo, hi = np.percentile(g, (1, 99))
    if hi - lo < 4:
        hi = lo + 4
    return np.ascontiguousarray(np.clip((g - lo) / (hi - lo), 0, 1), dtype=np.float32)


def movimiento_camara(a, b, ventana_cache={}, rejilla=(4, 4)):
    """Desplazamiento de CÁMARA (dx, dy) en px entre dos cuadros.

    Idea: si se mueve la cámara, TODOS los bloques del cuadro se desplazan; si solo se mueve el sujeto (manos, pincel, una
    persona), el fondo se queda quieto. Por eso no se usa la mediana (que sigue al sujeto cuando ocupa media pantalla) sino
    el cuarto más quieto de los bloques: eso es lo que de verdad "se mueve todo".
    """
    h, w = a.shape
    gi, gj = rejilla
    bh, bw = h // gi, w // gj
    key = (bh, bw)
    if key not in ventana_cache:
        ventana_cache[key] = cv2.createHanningWindow((bw, bh), cv2.CV_32F)
    win = ventana_cache[key]
    vec, resp = [], []
    for i in range(gi):
        for j in range(gj):
            pa = np.ascontiguousarray(a[i*bh:(i+1)*bh, j*bw:(j+1)*bw], dtype=np.float32)
            pb = np.ascontiguousarray(b[i*bh:(i+1)*bh, j*bw:(j+1)*bw], dtype=np.float32)
            if pa.std() < 0.03 or pb.std() < 0.03:        # bloque liso (fondo desenfocado): no informa
                continue
            (dx, dy), r = cv2.phaseCorrelate(pa, pb, win)
            vec.append((dx, dy)); resp.append(r)
    if len(vec) < 4:
        return 0.0, 0.0, 0.0                              # sin textura suficiente: no se puede medir
    vec = np.array(vec); resp = np.array(resp)
    ok = resp >= max(0.04, np.median(resp) * 0.4)         # descarta correlaciones sin pico claro
    if ok.sum() < 4:
        ok[:] = True
    vec, resp = vec[ok], resp[ok]
    mag = np.hypot(vec[:, 0], vec[:, 1])
    k = max(2, len(mag) // 4)
    idx = np.argsort(mag)[:k]                             # el cuarto de bloques más quietos = el fondo
    return float(np.median(vec[idx, 0])), float(np.median(vec[idx, 1])), float(np.median(resp[idx]))


def _cache_path(ruta, fps):
    st = os.stat(ruta)
    h = hashlib.sha1(f"{os.path.abspath(ruta)}|{st.st_size}|{int(st.st_mtime)}|{fps}|{ANCHO}|v3".encode()).hexdigest()[:16]
    d = os.path.expanduser("~/.cache/tomas-estables"); os.makedirs(d, exist_ok=True)
    return os.path.join(d, h + ".pkl")


def analizar(ruta, fps=FPS_ANALISIS, usar_cache=True):
    cp = _cache_path(ruta, fps)
    if usar_cache and os.path.exists(cp):
        return pickle.load(open(cp, "rb"))
    a = _analizar(ruta, fps)
    pickle.dump(a, open(cp, "wb"))
    return a


def _analizar(ruta, fps=FPS_ANALISIS):
    frames, w, h = leer_gris(ruta, fps)
    if len(frames) < 3:
        raise SystemExit(f"{ruta}: demasiado corto para analizar")
    norm = [_normalizar(f) for f in frames]
    n = len(norm)
    win = cv2.createHanningWindow((w, h), cv2.CV_32F)
    gdx = np.zeros(n); gdy = np.zeros(n)                   # traslación del cuadro completo (paneo)
    for i in range(1, n):
        (gdx[i], gdy[i]), _ = cv2.phaseCorrelate(norm[i-1], norm[i], win)
    dx = np.zeros(n); dy = np.zeros(n); resp = np.zeros(n)
    for i in range(1, n):
        dx[i], dy[i], resp[i] = movimiento_camara(norm[i-1], norm[i])
    vel = np.hypot(dx, dy) / w * 100 * fps                 # %/s del ancho
    foco = np.array([cv2.Laplacian(f, cv2.CV_32F).var() for f in frames])
    luz = np.array([f.mean() for f in frames])
    return dict(t=np.arange(n) / fps, fps=fps, gdx=gdx, gdy=gdy, dx=dx, dy=dy, vel=vel, foco=foco, luz=luz, w=w, h=h,
                duracion=n / fps)


def marcar_estables(a, perfil, ventana_s=1.0):
    """Marca cada cuadro como estable si, mirando la ventana de 1 s a su alrededor, cumple TODOS los criterios."""
    fps, n = a["fps"], len(a["t"])
    k = max(3, int(round(ventana_s * fps)))
    vel = a["vel"]
    ok = np.zeros(n, bool)
    for i in range(n):
        lo, hi = max(1, i - k // 2), min(n, i + k // 2 + 1)
        if hi - lo < 3:
            continue
        v = vel[lo:hi]
        deriva = math.hypot(a["dx"][lo:hi].sum(), a["dy"][lo:hi].sum()) / a["w"] * 100
        f = a["foco"][lo:hi]; foco_var = (f.max() - f.min()) / (np.median(f) + 1e-6)
        luz = a["luz"][lo:hi].max() - a["luz"][lo:hi].min()
        ok[i] = (np.median(v) <= perfil["vmed"] and np.percentile(v, 85) <= perfil["vpico"]
                 and deriva <= perfil["deriva"] and foco_var <= perfil["foco"] and luz <= perfil["luz"])
    return ok


def tramos(a, perfil, min_s=2.0, max_s=5.0, margen=0.3, particionar=True):
    ok = marcar_estables(a, perfil)
    fps = a["fps"]
    runs, i, n = [], 0, len(ok)
    while i < n:
        if ok[i]:
            j = i
            while j + 1 < n and ok[j + 1]:
                j += 1
            runs.append((i / fps, (j + 1) / fps))
            i = j + 1
        else:
            i += 1
    out = []
    for ini, fin in runs:
        ini += margen; fin -= margen                       # se recorta por dentro: los bordes son los cuadros dudosos
        if fin - ini < min_s:
            continue
        piezas = []
        if particionar and fin - ini > max_s:
            # un tramo estable largo se reparte en varios cortes de hasta max_s (se pueden usar todos)
            k = int(math.ceil((fin - ini) / max_s))
            largo = (fin - ini) / k
            piezas = [(ini + m * largo, ini + (m + 1) * largo) for m in range(k)]
        else:
            piezas = [(ini, min(fin, ini + max_s))]
        for p0, p1 in piezas:
            i0, i1 = int(round(p0 * fps)), int(round(p1 * fps))
            v = a["vel"][i0:i1 + 1].mean() if i1 > i0 else 0
            puntaje = float(1 / (1 + (v / perfil["vmed"]) ** 2))
            out.append(dict(inicio=round(p0, 2), fin=round(p1, 2), duracion=round(p1 - p0, 2), puntaje=round(puntaje, 3)))
    return out, runs


SUAVE = dict(consistencia=0.70, vmin=8.0, vmax=60.0, ventana=1.5)   # %/s del ancho; calibrado con C2263 (paneo 7-10 s)


def movimiento_suave(a, min_s=1.0, prm=SUAVE):
    """Tramos de movimiento deliberado y sostenido (paneo lado a lado o vertical): en una ventana de ~1.5 s la
    cámara avanza siempre hacia el mismo lado (consistencia = |suma|/suma de |pasos| >= 0.7) a velocidad moderada.
    Lo erratico ("cuadrando", temblor) cambia de signo cada pocos cuadros y da consistencia baja."""
    fps = a["fps"]; W = max(3, int(prm["ventana"] * fps)); n = len(a["t"]); segs = []
    for eje, escala, nombres in (("gdx", a["w"], ("izquierda", "derecha")), ("gdy", a["h"], ("arriba", "abajo"))):
        d = a[eje] / escala * 100 * fps
        for signo, nombre in ((-1, nombres[0]), (1, nombres[1])):     # ida y vuelta se separan
            marca = np.zeros(n, bool)
            for i in range(0, n - W):
                x = d[i+1:i+W+1]
                cons = abs(x.sum()) / (np.abs(x).sum() + 1e-6)
                if np.sign(x.sum()) == signo and cons >= prm["consistencia"] and prm["vmin"] <= abs(x.mean()) <= prm["vmax"]:
                    marca[i:i+W+1] = True
            i = 0
            while i < n:
                if marca[i]:
                    j = i
                    while j < n and marca[j]:
                        j += 1
                    if (j - i) / fps >= min_s:
                        segs.append(dict(inicio=round(i / fps, 2), fin=round(j / fps, 2), duracion=round((j - i) / fps, 2), direccion=nombre))
                    i = j
                else:
                    i += 1
    segs.sort(key=lambda z: z["inicio"])
    return segs


PANEO = dict(v_ini=20.0, v_pico=30.0, quieta_antes=0.4, v_quieta=20.0, min_s=0.4, max_s=2.5, desplaz_min=25.0, margen=0.07)  # %/s y % del ancho


def paneos_AB(a, prm=PANEO):
    """Paneo de A a B: el cuadro completo se desplaza en un solo sentido, en una ráfaga con perfil de campana,
    precedida de un instante de cámara quieta (no es 'cuadrando') y que termina cuando la cámara llega a B
    (la velocidad vuelve a ~0). El regreso B->A y los movimientos de reencuadre quedan fuera. Devuelve todos;
    el usuario usa solo el primero por toma. Referencia: C2263.MP4, 8;01-8;44 (8.02-8.73 s)."""
    fps = a["fps"]; n = len(a["t"])
    vx = a["gdx"] / a["w"] * 100 * fps; vy = a["gdy"] / a["h"] * 100 * fps
    k = np.ones(3) / 3
    vx = np.convolve(vx, k, "same"); vy = np.convolve(vy, k, "same")
    v = np.hypot(vx, vy); q = int(prm["quieta_antes"] * fps)
    out = []; i = q
    while i < n:
        if v[i] >= prm["v_ini"] and (v[i-q:i] < prm["v_quieta"]).all():
            j = i
            while j < n and v[j] >= prm["v_ini"]:
                j += 1
            dur = (j - i) / fps
            dx = vx[i:j].sum() / fps; dy = vy[i:j].sum() / fps          # % del ancho / alto
            sx = np.sign(vx[i:j]); consist = abs(vx[i:j].sum()) / (np.abs(vx[i:j]).sum() + 1e-6)
            if prm["min_s"] <= dur <= prm["max_s"] and v[i:j].max() >= prm["v_pico"] and abs(dx) >= prm["desplaz_min"] and consist >= 0.8:
                ini = float(a["t"][i-1]) + prm["margen"]; fin = float(a["t"][min(j, n-1)]) - prm["margen"]   # el umbral se cruza un poco antes/después de lo que se ve
                out.append(dict(inicio=round(ini, 3), fin=round(fin, 3), duracion=round(fin - ini, 2),
                                direccion="derecha" if dx > 0 else "izquierda", desplazamiento_pct=round(float(abs(dx)), 1)))
            i = j + q
        else:
            i += 1
    return out


FASES = dict(v_semilla=40.0, v_mov=20.0, gap_s=0.0, min_mov_s=0.35, min_quieta_s=0.5)   # %/s


def trayectoria(ruta, fps=30):
    """Movimiento de la cámara por cuadro (traslación x/y en % del cuadro, zoom en % log) con puntos de fondo
    + RANSAC: es robusto a manos/cabello que entran al cuadro. Positivo en x/y = el CONTENIDO se mueve a la
    derecha/abajo (la cámara hizo lo contrario). Cacheado como el análisis normal."""
    cp = _cache_path(ruta, fps).replace(".pkl", ".tray.pkl")
    if os.path.exists(cp):
        return pickle.load(open(cp, "rb"))
    frames, w, h = leer_gris(ruta, fps)
    F = [(_normalizar(f) * 255).astype(np.uint8) for f in frames]
    filas = [(0, 0, 0, 0.0)]
    for i in range(1, len(F)):
        p0 = cv2.goodFeaturesToTrack(F[i-1], 400, 0.01, 7)
        fila = (0, 0, 0, 0.0)
        if p0 is not None and len(p0) >= 12:
            p1, st, _ = cv2.calcOpticalFlowPyrLK(F[i-1], F[i], p0, None, winSize=(25, 25), maxLevel=3)
            ok = st.ravel() == 1
            if ok.sum() >= 12:
                M, inl = cv2.estimateAffinePartial2D(p0[ok], p1[ok], method=cv2.RANSAC, ransacReprojThreshold=1.2, maxIters=2000)
                if M is not None:
                    fila = (M[0, 2] / w * 100, M[1, 2] / h * 100, np.log(np.hypot(M[0, 0], M[1, 0])) * 100, float(inl.mean()))
        filas.append(fila)
    t = dict(fps=fps, tx=np.array([f[0] for f in filas]), ty=np.array([f[1] for f in filas]),
             z=np.array([f[2] for f in filas]), inl=np.array([f[3] for f in filas]))
    pickle.dump(t, open(cp, "wb"))
    return t


def fases_camara(t, prm=FASES):
    """Divide la toma en MOVIMIENTOS (la cámara se desplaza) y QUIETAS (hold). Cada movimiento trae dirección,
    zoom y su 'llegada' (cuando la cámara termina de llegar a B). Las pausas < gap_s no cortan un movimiento."""
    fps = t["fps"]; k = np.ones(3) / 3
    tx = np.convolve(t["tx"], k, "same"); ty = np.convolve(t["ty"], k, "same"); z = np.convolve(t["z"], k, "same")
    v = np.hypot(tx, ty) * fps; n = len(v)
    inl = np.convolve(t["inl"], k, "same")
    v = np.where((inl >= 0.28) | (v >= 100.0), v, 0.0)          # con manos/cabello en cuadro las lecturas lentas y poco fiables son ruido
    semilla = v >= prm["v_semilla"]; mov = v >= prm["v_mov"]         # histéresis: nace con pico, se extiende con lo suave
    tramos_ = []; i = 0
    while i < n:
        if mov[i]:
            j = i
            while j < n and mov[j]:
                j += 1
            if semilla[i:j].any():
                tramos_.append([i, j])
            i = j
        else:
            i += 1
    fus = []
    for a_, b_ in tramos_:                                   # une movimientos separados por una pausa corta
        if fus and (a_ - fus[-1][1]) / fps < prm["gap_s"]:
            fus[-1][1] = b_
        else:
            fus.append([a_, b_])
    out = []; prev_end = 0
    for a_, b_ in fus:
        if (b_ - a_) / fps < prm["min_mov_s"]:
            continue
        dx = tx[a_:b_].sum(); dy = ty[a_:b_].sum(); dz = z[a_:b_].sum()
        if abs(dx) > 2 * abs(dy): d = "lateral"
        elif abs(dy) > 2 * abs(dx): d = "vertical"
        else: d = "diagonal"
        if (a_ - prev_end) / fps >= prm["min_quieta_s"]:
            out.append(dict(tipo="quieta", inicio=round(prev_end / fps, 2), fin=round(a_ / fps, 2)))
        out.append(dict(tipo="movimiento", inicio=round(a_ / fps, 2), fin=round(b_ / fps, 2), llegada=round(b_ / fps, 2),
                        forma=d, contenido_dx=round(float(dx), 1), contenido_dy=round(float(dy), 1),
                        zoom=("acerca" if dz > 6 else "aleja" if dz < -6 else "no"), confianza=round(float(inl[a_:b_].mean()), 2)))
        prev_end = b_
    if (n - prev_end) / fps >= prm["min_quieta_s"]:
        out.append(dict(tipo="quieta", inicio=round(prev_end / fps, 2), fin=round(n / fps, 2)))
    return out


def cuadrando_hasta(a, perfil):
    """Segundo en que termina el 'cuadrar la toma': primer instante desde el que la cámara ya queda estable ≥1 s."""
    ok = marcar_estables(a, perfil)
    for i, v in enumerate(ok):
        if v:
            return round(i / a["fps"], 2)
    return None


def hoja_contacto(ruta, segs, salida, ancho=110):
    """Imagen con el primer y último cuadro de cada tramo, para revisarlos de un vistazo."""
    tiles = []
    for s in segs[:12]:
        for t in (s["inicio"], max(s["inicio"], s["fin"] - 0.15)):
            r = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", ruta, "-frames:v", "1", "-vf",
                                f"scale={ancho}:-2", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
            if r.stdout:
                tiles.append(cv2.imdecode(np.frombuffer(r.stdout, np.uint8), 1))
    if not tiles:
        return None
    hmin = min(t.shape[0] for t in tiles)
    tiles = [t[:hmin] for t in tiles]
    cv2.imwrite(salida, np.hstack(tiles))
    return salida


def grafico(a, ok, salida):
    """Línea de tiempo: velocidad de cámara y zonas estables en verde."""
    W, H = 900, 160
    img = np.full((H, W, 3), 25, np.uint8)
    n = len(a["t"]); vmax = max(8.0, np.percentile(a["vel"], 98))
    for i in range(n):
        x0, x1 = int(i / n * W), int((i + 1) / n * W)
        if ok[i]:
            img[:, x0:max(x1, x0 + 1)] = (35, 60, 35)
        y = int(H - 10 - min(a["vel"][i], vmax) / vmax * (H - 20))
        cv2.circle(img, (x0, y), 2, (0, 200, 255), -1)
    cv2.putText(img, f"{a['duracion']:.1f} s | velocidad de camara (%/s) | verde = estable", (6, 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (220, 220, 220), 1)
    cv2.imwrite(salida, img)
    return salida


def exportar(ruta, segs, carpeta, base=None):
    os.makedirs(carpeta, exist_ok=True)
    base = base or os.path.splitext(os.path.basename(ruta))[0]
    files = []
    for k, s in enumerate(segs, 1):
        out = os.path.join(carpeta, f"{base}_estable{k:02d}_{s['inicio']:.2f}-{s['fin']:.2f}.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(s["inicio"]), "-t", str(s["duracion"]), "-i", ruta,
                        "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-c:a", "aac", out], check=True)
        files.append(out)
    return files


def calibrar(positivos):
    """positivos: [{"video":..., "inicio":s, "fin":s}, ...] — tramos que el usuario dio por buenos.
    Devuelve la distribución de cada métrica dentro de ellos y umbrales sugeridos (percentil 75 = 'normal', 90 = 'flexible')."""
    vm, vp, der = [], [], []
    cache = {}
    for p in positivos:
        a = cache.get(p["video"]) or analizar(p["video"]); cache[p["video"]] = a
        i0 = int(p["inicio"] * a["fps"]) + 1
        i1 = min(int(p["fin"] * a["fps"]), len(a["t"]) - 1)
        if i1 - i0 < 3:
            continue
        v = a["vel"][i0:i1 + 1]
        vm.append(float(np.median(v))); vp.append(float(np.percentile(v, 85)))
        der.append(math.hypot(a["dx"][i0:i1 + 1].sum(), a["dy"][i0:i1 + 1].sum()) / a["w"] * 100 / max(1.0, (i1 - i0) / a["fps"]))
    res = {n: dict(mediana=round(float(np.median(x)), 2), p75=round(float(np.percentile(x, 75)), 2),
                   p90=round(float(np.percentile(x, 90)), 2), max=round(float(np.max(x)), 2))
           for n, x in (("vmed", vm), ("vpico", vp), ("deriva_por_s", der))}
    sug = {"normal": dict(vmed=round(res["vmed"]["p75"], 1), vpico=round(res["vpico"]["p75"], 1), deriva=round(max(res["deriva_por_s"]["p75"], 1.0), 1)),
           "flexible": dict(vmed=round(res["vmed"]["p90"], 1), vpico=round(res["vpico"]["p90"], 1), deriva=round(max(res["deriva_por_s"]["p90"], 2.0), 1))}
    return res, sug


def main():
    ap = argparse.ArgumentParser(description="Encuentra tramos estables (cámara quieta) en videos.")
    ap.add_argument("videos", nargs="*")
    ap.add_argument("--min", type=float, default=2.0, help="duración mínima de un corte (s)")
    ap.add_argument("--max", type=float, default=5.0, help="duración máxima de un corte (s)")
    ap.add_argument("--sens", choices=list(PERFILES) + ["auto"], default="auto",
                    help="auto (default): el nivel más estricto que aún da cortes; o fija estricto/normal/flexible")
    ap.add_argument("--suave", action="store_true", help="lista además los tramos de movimiento suave y sostenido (paneo/zoom lento)")
    ap.add_argument("--paneos", action="store_true", help="lista paneos A->B (ráfaga que termina al llegar a B); se usa solo el primero por toma")
    ap.add_argument("--fases", action="store_true", help="línea de tiempo de movimientos (con dirección/zoom/llegada) y momentos quietos")
    ap.add_argument("--json", help="guarda el resultado en este archivo")
    ap.add_argument("--exportar", help="carpeta donde cortar los tramos como .mp4")
    ap.add_argument("--hoja", action="store_true", help="genera una hoja de contacto por video (<video>.estables.png)")
    ap.add_argument("--grafico", action="store_true", help="genera la línea de tiempo (<video>.movimiento.png)")
    ap.add_argument("--salida", default="/tmp/tomas-estables", help="carpeta para hojas y gráficos (no se escribe junto al video)")
    ap.add_argument("--calibrar", help="JSON con tramos buenos [{video,inicio,fin}] para sugerir umbrales")
    args = ap.parse_args()

    if args.calibrar:
        res, sug = calibrar(json.load(open(args.calibrar)))
        print(json.dumps(dict(dentro_de_los_tramos_buenos=res, umbrales_sugeridos=sug), indent=2, ensure_ascii=False))
        return
    if not args.videos:
        ap.error("falta al menos un VIDEO")
    todo = {}
    for v in args.videos:
        a = analizar(v)
        niveles = list(PERFILES) if args.sens == "auto" else [args.sens]
        for nivel in niveles:                              # auto: del más estricto al más flexible, se queda con el primero que rinde
            perfil = PERFILES[nivel]
            segs, runs = tramos(a, perfil, args.min, args.max)
            if segs:
                break
        ok = marcar_estables(a, perfil)
        cuad = cuadrando_hasta(a, perfil)
        for sg in segs:
            sg["nivel"] = nivel
        todo[v] = dict(duracion=round(a["duracion"], 2), nivel=nivel, cuadrando_hasta=cuad, tramos=segs)
        print(f"\n{os.path.basename(v)}  ({a['duracion']:.1f} s)  nivel: {nivel}  cámara estable desde: {cuad if cuad is not None else 'nunca'} s")
        if not segs:
            print("   (sin tramos estables de al menos %.1f s con esta sensibilidad)" % args.min)
        for s in segs:
            print(f"   {s['inicio']:7.2f} → {s['fin']:7.2f}   {s['duracion']:.1f} s   puntaje {s['puntaje']:.2f}")
        if args.fases:
            fa = fases_camara(trayectoria(v))
            todo[v]["fases"] = fa
            print("   fases de cámara:")
            for z in fa:
                extra = "" if z["tipo"] == "quieta" else f"  {z['forma']}, zoom {z['zoom']}, conf {z['confianza']:.2f}, contenido ({z['contenido_dx']:+.0f}%, {z['contenido_dy']:+.0f}%)"
                print(f"   {z['inicio']:6.2f} → {z['fin']:6.2f}  {z['tipo']}{extra}")
        if args.paneos:
            pa = paneos_AB(analizar(v, fps=30))
            todo[v]["paneos_AB"] = pa
            print("   paneos A→B (usar el primero):" + ("" if pa else " ninguno"))
            for z in pa:
                print(f"   {z['inicio']:7.2f} → {z['fin']:7.2f}   {z['duracion']:.2f} s   hacia {z['direccion']}  ({z['desplazamiento_pct']:.0f} % del ancho)")
        if args.suave:
            sv = movimiento_suave(a, args.min if args.min < 2 else 1.0)
            todo[v]["suaves"] = sv
            print("   movimiento suave (paneo):" + ("" if sv else " ninguno"))
            for s in sv:
                print(f"   {s['inicio']:7.2f} → {s['fin']:7.2f}   {s['duracion']:.1f} s   hacia {s['direccion']}")
        if (args.hoja and segs) or args.grafico:
            os.makedirs(args.salida, exist_ok=True)
        base = os.path.join(args.salida, os.path.basename(v))
        if args.hoja and segs:
            print("   hoja:", hoja_contacto(v, segs, base + ".estables.png"))
        if args.grafico:
            print("   gráfico:", grafico(a, ok, base + ".movimiento.png"))
        if args.exportar and segs:
            exportar(v, segs, args.exportar)
    if args.json:
        json.dump(todo, open(args.json, "w"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
