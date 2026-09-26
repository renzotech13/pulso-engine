# estilos — biblioteca de títulos, CTAs y subtítulos por nombre clave

Cada estilo es UNA pieza independiente con nombre propio. Se usa solo la clave; no hay que recordar presets, banderas ni rutas.

```
config/estilos/
  titulos/      aura-titulo-inicial.json     título de apertura (3 niveles)
  ctas/         aura-cta-final.json          CTA final sostenido hasta el último cuadro
  subtitulos/   aura-subtitulos.json         subtítulos karaoke por palabra
  _base.json                                 base para componer presets completos (no es un estilo)
  bin/cta-sostenido.sh                       lo usa `estilo cta`
  estilo  (estilo.py)                        el comando
```

## Uso (desde `apps/video-editor/config/estilos/`, o con la ruta completa)
```bash
./estilo lista                                            # todas las claves
./estilo ver aura-cta-final                               # qué es y cómo se usa
./estilo titulo aura-titulo-inicial in.mp4 out.mp4 "Balayage | no son mechas | ES OTRA TÉCNICA"
./estilo cta aura-cta-final in.mp4 out.mp4 "escríbeme | BALAYAGE | y te mando la guía" 4.14      # últimos 4.14 s
./estilo subtitulos aura-subtitulos in.mp4 out.mp4 guion.txt     # guion EXACTO de la voz (texto o .txt)
./estilo preset --titulo aura-titulo-inicial --subtitulos aura-subtitulos   # imprime la ruta de un preset completo
./estilo verificar                                        # todas las claves cargan y sus fuentes están instaladas
```
Orden que se usó en Aura: `titulo` → `cta` → `subtitulos` (cada uno toma la salida del anterior).
Los textos de 3 niveles se escriben `"arriba | MEDIO | abajo"`. Lo que pases después de los argumentos
(`--duracion 4`, `--pos-y 0.4`, …) pisa el valor por defecto de la clave.

## Mezclar (por eso son independientes)
Un título de una marca con los subtítulos de otra funciona: `estilo preset --titulo X --subtitulos Y` arma el preset completo
(el esquema exige título+subtítulos) y devuelve la ruta para el pipeline completo (`--preset <ruta>`).

## Agregar un estilo nuevo (otra marca u otra sesión)
1. Copiar el archivo del tipo que corresponda (`titulos/`, `ctas/` o `subtitulos/`) con otro nombre.
2. Cambiar `clave` (única, con prefijo de marca: `az-…`, `cliente-…`), `marca`, `descripcion`, `aplica` y la sección
   (`titulo` o `subtitulos`, con el mismo formato de `config/presets/*.json`).
3. `./estilo verificar`. No hay catálogo central que editar: cada clave es su propio archivo, así dos sesiones no se pisan.
Los presets viejos de `config/presets/` (p. ej. los `az-*`) siguen funcionando igual; se registran aquí solo cuando se quiera usarlos por clave.

## Requisitos
Fuentes instaladas en `~/Library/Fonts` (Mrs Hannah, Scholar, Day Dreaming, Grift…; `estilo verificar` avisa cuáles faltan),
`npx tsx` (dependencias del paquete), ffmpeg y el modelo Whisper `models/ggml-small.bin` para subtítulos.

## Claves actuales
| Clave | Tipo | Marca | Origen |
|---|---|---|---|
| `aura-titulo-inicial` | título | Aura | `presets/aura-edits.json` → titulo (`--pos-y 0.5 --duracion 5`) |
| `aura-cta-final` | CTA | Aura | `presets/cta-aura-3-niveles.json` + velo oscuro, sostenido, `--llenar-medio on --ancho-maximo 0.88 …` |
| `aura-subtitulos` | subtítulos | Aura | `presets/aura-edits.json` → subtitulos |
| `movistar-titulo-gruesa-serif` | título | Movistar | título de apertura centrado, 3 niveles |
| `movistar-titulo-gruesa-serif-izquierda` | título | Movistar | variante del anterior pegada al margen izquierdo (vertical 1080x1920) |
| `movistar-titulo-inicial-este-mes` | título | Movistar | "Este mes, no cambies tu número. / Cambia todo / lo demás." (30px más arriba que la variante izquierda) |
| `movistar-subtitulo-negrita-regular` | título | Movistar | Secundario más chico (52px) DEBAJO del inicial: "Pásate a Movistar" en negrita + 2 líneas regular |
| `movistar-cta-final-square` | CTA | Movistar | "Dale clic \| en el anuncio", SOLO para 1080x1080 |
| `movistar-cta-escribenos-whatsapp` | CTA | Movistar | "Escríbenos \| por WhatsApp" (1080x1920), duracionSeg=999 a propósito para que NO tenga animación de salida — ver el campo `aplica` del propio archivo |

## Elementos que NO son título/CTA/subtítulo (composiciones Remotion aparte)
Los pills de beneficios, el card de precio y la flecha animada no pasan por `titulo-cli.ts`/`estilo` — son composiciones propias de `apps/render-video` (`feature-cards`, `precio-card-plan`, `arrow-down`), renderizadas con `precio-card-cli.ts` y compuestas sobre el video con `ffmpeg overlay` (o `colorkey` + `overlay` cuando el archivo ya viene sin canal alfa). Se documentan igual, por clave, en `config/estilos/elementos/` — cada archivo trae su propio `props` listo para copiar/pegar y sus pasos de "cómo reutilizar":

| Clave | Composición | Marca | Qué es |
|---|---|---|---|
| `movistar-pills-beneficios` | `feature-cards` | Movistar | 4 pills blancos con ícono celeste y borde animado, pills altos (130px) y círculo del ícono de la MISMA altura del pill |
| `movistar-precio-ilimitado` | `precio-card-plan` | Movistar | Card "Plan desde S/39.90 \| Internet ilimitado" con brillo de borde viajero (archivo ya aprobado en disco) |
| `movistar-pill-stack` | `pill-stack` | Movistar | 3 pills pegados: Cámbiate a Movistar (+M animada) / Internet ilimitado (wifi grande, turquesa) / S/39.90 con borde celeste y líneas afuera. TODO aprobado |
| `movistar-titulo-pill-bitel` | `titulo-pill` | Movistar | Título en pill escalonado azul sólido, línea 1 blanca / línea 2 turquesa, chispas a caballo del borde, con rebote: "¿Eres Bitel y quieres / internet ilimitado?" |
| `movistar-titulo-ola` | `titulo-olas` | Movistar | Título de 3 líneas donde cada letra entra con rebote y luego se mueve como ola lenta y constante: "SEÑAL Y DATOS / ILIMITADOS / EN TODO EL PERÚ" |
| `movistar-titulo-ola-pill` | `titulo-ola-pill` | Movistar | Línea de arriba con letras en ola lenta + pill azul sólido abajo que entra con rebote: "¿PAGAS MÁS DE / S/ 50 EN CLARO O ENTEL?" |
| `movistar-cta-ola` | `cta-ola` | Movistar | CTA propio: 2 filas con letras en ola lenta (como movistar-titulo-ola) y SIEMPRE con la flecha movistar-flecha-abajo debajo, incluida en la composición. Reemplaza a los CTA heredados |
| `movistar-flecha-abajo` | `arrow-down` | Movistar | 3 chevrones celestes parpadeando en cascada, para ir bajo un CTA |

## Renombres 2026-09-24 (Movistar)
| Antes | Ahora |
|---|---|
| movistar-titulo-inicial | movistar-titulo-gruesa-serif (se usa para todos los videos; solo cambia el texto, misma estructura de 3 niveles) |
| movistar-titulo-inicial-izquierda | movistar-titulo-gruesa-serif-izquierda |
| movistar-titulo-beneficios-negrita | movistar-subtitulo-negrita-regular |
| movistar-pills-beneficios-celeste-alto | movistar-pills-beneficios |
| movistar-precio-plan-borde-luz | movistar-precio-ilimitado |
| movistar-flecha-abajo-celeste | movistar-flecha-abajo |
| (pill de WhatsApp, sin clave) | movistar-pill-whatsapp (nuevo, elementos/) |
| card "A solo S/39.90 \| 225 GB" | movistar-pills-39-225gb (nuevo, elementos/) |
Además: movistar-titulo-pill-bitel subido 200px (posicionYFrac 0.1958) y movistar-titulo-ola-pill subido 168px (0.0625; 200px recortaba la línea de arriba).

| `movistar-transicion-destello` | efecto | Movistar | Destello paleta fría en el empalme de los UGC de Veo (tramo 8 s + extensión), sin whoosh; ver elementos/movistar-transicion-destello.json |
