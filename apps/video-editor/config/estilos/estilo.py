#!/usr/bin/env python3
"""estilo — usar títulos, CTAs y subtítulos por NOMBRE CLAVE (sin acordarse de presets, banderas ni rutas).

  estilo lista                                  claves disponibles por tipo y marca
  estilo ver <clave>                            descripción, uso y parámetros de una clave
  estilo titulo <clave> ENTRADA SALIDA "a | B | c" [--duracion N] [banderas de titulo-cli]
  estilo cta <clave> ENTRADA SALIDA "a | B | c" [segundos=3] [pos_y]
  estilo subtitulos <clave> ENTRADA SALIDA <guion|ruta.txt> [banderas de subtitulos-cli]
  estilo preset [--titulo K] [--cta K] [--subtitulos K] [--out ruta.json]   preset completo combinando claves
  estilo verificar                              valida que todas las claves cargan y sus fuentes están instaladas
Cada clave vive en su propio archivo (titulos/, ctas/, subtitulos/): agregar la tuya = copiar uno y cambiar `clave`.
"""
import json, os, subprocess, sys, tempfile, glob, shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
EDITOR = os.path.abspath(os.path.join(AQUI, "..", ".."))
CARPETAS = {"titulo": "titulos", "cta": "ctas", "subtitulos": "subtitulos"}
SECCION = {"titulo": "titulo", "cta": "titulo", "subtitulos": "subtitulos"}
MODELO = os.path.join(EDITOR, "models", "ggml-small.bin")

def cargar_todas():
    est = {}
    for tipo, carpeta in CARPETAS.items():
        for f in sorted(glob.glob(os.path.join(AQUI, carpeta, "*.json"))):
            d = json.load(open(f)); d["_archivo"] = f
            if d.get("clave") in est: sys.exit(f"clave repetida: {d['clave']}")
            est[d["clave"]] = d
    return est

def obtener(est, clave, tipo=None):
    if clave not in est:
        sys.exit(f"no existe la clave '{clave}'. Disponibles: {', '.join(sorted(est)) or '(ninguna)'}")
    d = est[clave]
    if tipo and d["tipo"] != tipo: sys.exit(f"'{clave}' es de tipo {d['tipo']}, no {tipo}")
    return d

def componer(est, titulo=None, subtitulos=None, salida=None):
    """Preset completo (el esquema exige título+subtítulos): _base.json con las secciones de las claves pedidas."""
    p = json.load(open(os.path.join(AQUI, "_base.json")))
    nombres = []
    for k in (titulo, subtitulos):
        if k:
            d = est[k]; p[SECCION[d["tipo"]]] = d[SECCION[d["tipo"]]]; nombres.append(k)
    p["id"] = "estilos-" + "+".join(nombres or ["base"]); p["nombre"] = "Estilos: " + " + ".join(nombres or ["base"])
    ruta = salida or os.path.join(tempfile.mkdtemp(prefix="estilo-"), p["id"] + ".json")
    open(ruta, "w").write(json.dumps(p, ensure_ascii=False, indent=2)); return os.path.abspath(ruta)

def tsx(script, *args, env=None):
    e = dict(os.environ); e.update(env or {})
    subprocess.run(["npx", "tsx", script, *args], cwd=EDITOR, check=True, env=e)

def main():
    a = sys.argv[1:]
    if not a or a[0] in ("-h", "--help", "ayuda"): print(__doc__); return
    cmd, rest = a[0], a[1:]; est = cargar_todas()
    if cmd == "lista":
        for tipo, titulo in (("titulo", "TÍTULOS"), ("cta", "CTAs"), ("subtitulos", "SUBTÍTULOS")):
            print(f"\n{titulo}")
            for k, d in est.items():
                if d["tipo"] == tipo: print(f"  {k:<26} [{d.get('marca','-')}] {d['descripcion'].split('. ')[0][:90]}")
        print(); return
    if cmd == "ver":
        d = obtener(est, rest[0]); print(json.dumps({k: v for k, v in d.items() if k not in ("titulo", "subtitulos", "_archivo")}, ensure_ascii=False, indent=2))
        print("archivo:", d["_archivo"]); return
    if cmd == "titulo":
        clave, ent, sal, texto, *extra = rest; d = obtener(est, clave, "titulo")
        flags = list(d["aplica"].get("flags", []))
        for f in ("--duracion", "--pos-y"):        # lo que el usuario pase pisa el default de la clave
            if f in extra and f in flags: del flags[flags.index(f):flags.index(f) + 2]
        tsx("src/titulo-cli.ts", os.path.abspath(ent), os.path.abspath(sal), texto, "--preset", componer(est, titulo=clave), *flags, *extra); return
    if cmd == "cta":
        clave, ent, sal, texto, *r = rest; d = obtener(est, clave, "cta")
        seg = r[0] if r else "3"; posy = r[1] if len(r) > 1 else str(d["aplica"].get("pos_y", 0.6))
        subprocess.run([os.path.join(AQUI, "bin", "cta-sostenido.sh"), ent, sal, texto, seg, posy, componer(est, titulo=clave), *d["aplica"].get("flags", [])], check=True); return
    if cmd == "subtitulos":
        clave, ent, sal, guion, *extra = rest; d = obtener(est, clave, "subtitulos")
        tsx("src/subtitulos-cli.ts", os.path.abspath(ent), os.path.abspath(sal), guion, "--preset", componer(est, subtitulos=clave), *d["aplica"].get("flags", []), *extra,
            env={"WHISPER_MODEL_PATH": os.environ.get("WHISPER_MODEL_PATH", MODELO)}); return
    if cmd == "preset":
        t = s = out = None; i = 0
        while i < len(rest):
            if rest[i] in ("--titulo", "--cta"): t = obtener(est, rest[i + 1])["clave"]; i += 2
            elif rest[i] == "--subtitulos": s = obtener(est, rest[i + 1], "subtitulos")["clave"]; i += 2
            elif rest[i] == "--out": out = rest[i + 1]; i += 2
            else: sys.exit(f"opción desconocida: {rest[i]}")
        print(componer(est, t, s, out)); return
    if cmd == "verificar":
        fam = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True).stdout.lower()
        fallos = 0
        for k, d in est.items():
            ruta = componer(est, titulo=k if d["tipo"] != "subtitulos" else None, subtitulos=k if d["tipo"] == "subtitulos" else None)
            r = subprocess.run(["npx", "tsx", "-e", f'import("./src/pipeline/preset.ts").then(m=>m.loadPreset({json.dumps(ruta)})).catch(e=>{{console.error(String(e.message||e));process.exit(1)}})'],
                               cwd=EDITOR, capture_output=True, text=True)
            fuentes = set()
            def buscar(o):
                if isinstance(o, dict):
                    if "familia" in o: fuentes.add(o["familia"])
                    for v in o.values(): buscar(v)
            buscar(d[SECCION[d["tipo"]]])
            faltan = sorted(f for f in fuentes if f.lower() not in fam and f not in ("Georgia", "Helvetica", "Inter"))
            ok = r.returncode == 0 and not faltan; fallos += (not ok)
            print(f"{'OK ' if ok else 'MAL'} {k:<26} preset {'carga' if r.returncode == 0 else 'NO carga: ' + r.stderr.strip()[-160:]}" + (f" · fuentes sin instalar: {', '.join(faltan)}" if faltan else ""))
        sys.exit(1 if fallos else 0)
    sys.exit(f"comando desconocido: {cmd}\n{__doc__}")

main()
