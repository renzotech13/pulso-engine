---
name: estilos-titulos-subtitulos
description: Biblioteca de títulos, CTAs y subtítulos por NOMBRE CLAVE (aura-titulo-inicial, aura-cta-final, aura-subtitulos, y los que se agreguen de otras marcas). Usar cuando el usuario mencione una clave o pida poner el título inicial / CTA / subtítulos de una marca sobre un video ya armado, o agregar/mezclar estilos de títulos y subtítulos.
---

# Estilos de títulos, CTAs y subtítulos (por nombre clave)

Carpeta: `apps/video-editor/config/estilos/` (README ahí). Comando: `apps/video-editor/config/estilos/estilo` (`lista`, `ver`, `titulo`, `cta`, `subtitulos`, `preset`, `verificar`).
Si el usuario da solo el nombre ("ponle aura-cta-final"), NO buscar presets ni recordar banderas: usar `estilo`.

```bash
E=apps/video-editor/config/estilos/estilo
$E lista
$E titulo aura-titulo-inicial in.mp4 out.mp4 "Balayage | no son mechas | ES OTRA TÉCNICA"
$E cta aura-cta-final in.mp4 out.mp4 "escríbeme | BALAYAGE | y te mando la guía" <segundos-finales> [pos_y]
$E subtitulos aura-subtitulos in.mp4 out.mp4 guion.txt
```
Orden habitual: título → CTA → subtítulos (cada paso toma la salida del anterior). Nunca escribir sobre el video de entrada.

- **Textos 3 niveles:** `"arriba | MEDIO | abajo"`. Si el medio es largo el CTA lo ajusta solo (`--llenar-medio on`); para el título, bajar `--tam-medio`.
- **CTA de Aura en el pipeline orgánico:** los `segundos` = duración total − (segundo en que la voz dice "Escríbeme" − 0.5); así entra medio segundo antes de la frase y se sostiene hasta el último cuadro.
- **Subtítulos:** necesitan el guion exacto de la voz; alinean con Whisper local (`models/ggml-small.bin`, ya configurado por `estilo`).
- **Agregar un estilo (otra marca/sesión):** copiar un JSON de `titulos/`, `ctas/` o `subtitulos/`, cambiar `clave` (prefijo de marca) y la sección, correr `estilo verificar`. Cada clave es su propio archivo: no hay catálogo central que editar, así dos sesiones no se pisan. No editar `config/presets/*.json` ni `src/pipeline/preset.ts`: otras sesiones los usan/modifican.
- **Mezclar:** `estilo preset --titulo K1 --subtitulos K2` devuelve la ruta de un preset completo (el esquema exige ambos) para `--preset` del pipeline.
- Las claves de Aura son copias congeladas de `aura-edits.json` / `cta-aura-3-niveles.json`: el `cta-referencia-3-niveles.json` compartido lo modifica otra sesión (azul de AZ), no usarlo para Aura.
- Fuentes de marca en `~/Library/Fonts`; `estilo verificar` dice cuáles faltan.

Efectos sobre el video ya armado (destello, whoosh, textos casuales con emoji): skill `efectos-video`. Color/cortes de Aura: `editar-video-aura`.
