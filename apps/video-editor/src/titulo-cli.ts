#!/usr/bin/env tsx
// Standalone: pone un título (simple o "tresNiveles", según el preset) sobre
// un video YA terminado — p. ej. la salida de bg-replace-multi.ts — sin pasar
// por el pipeline de guion (nada de transcripción, EDL, subtítulos ni
// música). El overlay solo se ve durante titulo.duracionSeg; el resto del
// video sigue igual, tal cual venía.
//
// Uso:
//   tsx src/titulo-cli.ts <video-entrada> <video-salida> "Texto del título" \
//     [--preset ruta.json] [--duracion 5] [--color-medio "#FDFBC0"] [--pos-y 0.68] \
//     [--sombra on|off] [--ancho-maximo 0.94] \
//     [--tam-superior 90] [--tam-medio 150] [--tam-inferior 54] \
//     [--espacio-superior 0] [--espacio-medio -20] [--espacio-inferior 10] \
//     [--llenar-superior on] [--llenar-medio on] [--llenar-inferior on]
//
// El texto de un título "tresNiveles" (preset.titulo.estilo) lleva sus 3
// líneas separadas por "|": "Blanco Rosa | ROSA | palo".
//
// Todos estos son overrides rápidos para probar variantes sin editar el
// preset — el resto de la config (fuentes, animación) siempre sale de ahí:
//   --sombra on|off      sombra ligera en los 3 niveles a la vez (on) o la
//                        saca aunque el preset ya traiga una (off).
//   --tam-*              tamaño de fuente (px) de ESE nivel — el control
//                        principal para que un texto largo entre en una
//                        sola línea: si se corta a 2 líneas, bajale el
//                        tamaño, o subí --ancho-maximo si sobra margen a
//                        los costados y preferís aprovecharlo en vez de
//                        achicar la letra.
//   --llenar-* on|off    escala ESE nivel hasta que su texto ocupe todo el
//                        ancho disponible, sin partirse nunca en 2 líneas.
//                        Con esto --tam-* de ese nivel deja de ser el
//                        tamaño final (pasa a ser solo el punto de partida
//                        que se escala): el ancho del cuadro decide. Es la
//                        forma de tenerlo lo más grande posible sin ir
//                        probando tamaños a mano.
//   --ancho-maximo       fracción del ancho del video (0-1, default 0.86)
//                        que puede usar el BLOQUE del título entero (los 3
//                        niveles juntos, o la única línea de un título
//                        "simple") antes de partirse en 2 líneas — subirlo
//                        (ej. 0.94) achica el margen de seguridad a los
//                        costados y le da más lugar a un tamaño grande.
//   --espacio-*          separación (px) entre ESE nivel y el de arriba
//                        (negativo los acerca, positivo los aleja) — el
//                        "line height" entre niveles.
//   --pos-y              posición vertical del BLOQUE de los 3 niveles
//                        junto (0=arriba del todo, 1=abajo del todo) — no
//                        hay una posición por nivel suelta: siempre van
//                        apilados en el mismo orden, solo se ajusta el
//                        espacio entre ellos (--espacio-*) y dónde cae el
//                        bloque entero (--pos-y).

import path from "node:path";
import { loadDefaultPreset, loadPreset, type Preset } from "./pipeline/preset.js";
import { overlayTituloSobreVideo } from "./pipeline/render.js";

function usageError(): never {
  console.error(
    'uso: tsx src/titulo-cli.ts <video-entrada> <video-salida> "Texto del título" ' +
      '[--preset ruta.json] [--duracion segundos] [--color-medio "#RRGGBB"] [--pos-y 0-1] [--sombra on|off] ' +
      "[--ancho-maximo 0-1] [--tam-superior px] [--tam-medio px] [--tam-inferior px] " +
      "[--espacio-superior px] [--espacio-medio px] [--espacio-inferior px] " +
      "[--llenar-superior on|off] [--llenar-medio on|off] [--llenar-inferior on|off]",
  );
  process.exit(1);
}

function flag(rest: string[], name: string): string | undefined {
  const idx = rest.indexOf(`--${name}`);
  return idx !== -1 && rest[idx + 1] ? rest[idx + 1] : undefined;
}

// A subtle default, not configurable from the CLI on purpose — --sombra is
// meant as a quick on/off for "este fondo está muy claro", not a place to
// tune color/offset. Dial it in via the preset JSON's nivel.sombra instead
// if a specific take needs something stronger.
const SOMBRA_LIGERA = { color: "#00000066", desplazamiento: 2 };
// Para arranques con fondo claro: más opaca, más gruesa y con halo alrededor de la letra.
const SOMBRA_FUERTE = { color: "#000000A0", desplazamiento: 4, blur: 8, halo: true };

type TresNiveles = NonNullable<Preset["titulo"]["tresNiveles"]>;
type Nivel = TresNiveles["superior"];

/** Merges a per-level patch (only for the levels actually named) into a tresNiveles object — every override flag below (tamaño, espacio, sombra) shares this same "patch just this one field on just these levels" shape. */
function withNivelPatches(tn: TresNiveles, patches: Partial<Record<keyof TresNiveles, Partial<Nivel>>>): TresNiveles {
  return {
    superior: patches.superior ? { ...tn.superior, ...patches.superior } : tn.superior,
    medio: patches.medio ? { ...tn.medio, ...patches.medio } : tn.medio,
    inferior: patches.inferior ? { ...tn.inferior, ...patches.inferior } : tn.inferior,
  };
}

interface Overrides {
  colorMedio?: string | undefined;
  posY?: string | undefined;
  anchoMaximo?: string | undefined;
  sombra?: string | undefined;
  tamSuperior?: string | undefined;
  tamMedio?: string | undefined;
  tamInferior?: string | undefined;
  espacioSuperior?: string | undefined;
  espacioMedio?: string | undefined;
  espacioInferior?: string | undefined;
  llenarSuperior?: string | undefined;
  llenarMedio?: string | undefined;
  llenarInferior?: string | undefined;
}

function applyOverrides(preset: Preset, o: Overrides): Preset {
  let titulo = preset.titulo;
  if (o.posY !== undefined) titulo = { ...titulo, posicionYFrac: Number(o.posY) };
  if (o.anchoMaximo !== undefined) titulo = { ...titulo, anchoMaximoFrac: Number(o.anchoMaximo) };

  // Every remaining override touches tresNiveles specifically — resolved
  // once here so each one below fails with the same clear message instead
  // of a confusing "Cannot read properties of undefined" deeper in.
  const needsNiveles =
    o.colorMedio !== undefined ||
    o.sombra !== undefined ||
    [
      o.tamSuperior,
      o.tamMedio,
      o.tamInferior,
      o.espacioSuperior,
      o.espacioMedio,
      o.espacioInferior,
      o.llenarSuperior,
      o.llenarMedio,
      o.llenarInferior,
    ].some((v) => v !== undefined);
  if (needsNiveles && !titulo.tresNiveles) {
    throw new Error('--color-medio/--sombra/--tam-*/--espacio-*/--llenar-* solo aplican a un preset con titulo.estilo "tresNiveles"');
  }

  if (o.colorMedio !== undefined) {
    titulo = { ...titulo, tresNiveles: withNivelPatches(titulo.tresNiveles!, { medio: { color: o.colorMedio } }) };
  }

  if (o.sombra !== undefined) {
    if (o.sombra !== "on" && o.sombra !== "off" && o.sombra !== "fuerte") throw new Error('--sombra solo acepta "on", "fuerte" u "off"');
    const sombra = o.sombra === "on" ? SOMBRA_LIGERA : o.sombra === "fuerte" ? SOMBRA_FUERTE : undefined;
    titulo = { ...titulo, tresNiveles: withNivelPatches(titulo.tresNiveles!, { superior: { sombra }, medio: { sombra }, inferior: { sombra } }) };
  }

  if (o.tamSuperior !== undefined || o.tamMedio !== undefined || o.tamInferior !== undefined) {
    titulo = {
      ...titulo,
      tresNiveles: withNivelPatches(titulo.tresNiveles!, {
        ...(o.tamSuperior !== undefined ? { superior: { tamano: Number(o.tamSuperior) } } : {}),
        ...(o.tamMedio !== undefined ? { medio: { tamano: Number(o.tamMedio) } } : {}),
        ...(o.tamInferior !== undefined ? { inferior: { tamano: Number(o.tamInferior) } } : {}),
      }),
    };
  }

  if (o.llenarSuperior !== undefined || o.llenarMedio !== undefined || o.llenarInferior !== undefined) {
    const parse = (v: string | undefined, flag: string): boolean | undefined => {
      if (v === undefined) return undefined;
      if (v !== "on" && v !== "off") throw new Error(`--${flag} solo acepta "on" u "off"`);
      return v === "on";
    };
    const superior = parse(o.llenarSuperior, "llenar-superior");
    const medio = parse(o.llenarMedio, "llenar-medio");
    const inferior = parse(o.llenarInferior, "llenar-inferior");
    titulo = {
      ...titulo,
      tresNiveles: withNivelPatches(titulo.tresNiveles!, {
        ...(superior !== undefined ? { superior: { ajustarAlAncho: superior } } : {}),
        ...(medio !== undefined ? { medio: { ajustarAlAncho: medio } } : {}),
        ...(inferior !== undefined ? { inferior: { ajustarAlAncho: inferior } } : {}),
      }),
    };
  }

  if (o.espacioSuperior !== undefined || o.espacioMedio !== undefined || o.espacioInferior !== undefined) {
    titulo = {
      ...titulo,
      tresNiveles: withNivelPatches(titulo.tresNiveles!, {
        ...(o.espacioSuperior !== undefined ? { superior: { margenSuperiorPx: Number(o.espacioSuperior) } } : {}),
        ...(o.espacioMedio !== undefined ? { medio: { margenSuperiorPx: Number(o.espacioMedio) } } : {}),
        ...(o.espacioInferior !== undefined ? { inferior: { margenSuperiorPx: Number(o.espacioInferior) } } : {}),
      }),
    };
  }

  return { ...preset, titulo };
}

async function main(): Promise<void> {
  const [input, output, texto, ...rest] = process.argv.slice(2);
  if (!input || !output || !texto) usageError();

  const presetArg = flag(rest, "preset");
  const basePreset = presetArg ? await loadPreset(path.resolve(presetArg)) : await loadDefaultPreset();
  const preset = applyOverrides(basePreset, {
    colorMedio: flag(rest, "color-medio"),
    posY: flag(rest, "pos-y"),
    anchoMaximo: flag(rest, "ancho-maximo"),
    sombra: flag(rest, "sombra"),
    tamSuperior: flag(rest, "tam-superior"),
    tamMedio: flag(rest, "tam-medio"),
    tamInferior: flag(rest, "tam-inferior"),
    espacioSuperior: flag(rest, "espacio-superior"),
    espacioMedio: flag(rest, "espacio-medio"),
    espacioInferior: flag(rest, "espacio-inferior"),
    llenarSuperior: flag(rest, "llenar-superior"),
    llenarMedio: flag(rest, "llenar-medio"),
    llenarInferior: flag(rest, "llenar-inferior"),
  });
  const duracionArg = flag(rest, "duracion");

  await overlayTituloSobreVideo(path.resolve(input), path.resolve(output), preset, texto, {
    ...(duracionArg ? { duracionSeg: Number(duracionArg) } : {}),
  });

  console.log(`listo: ${output}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
