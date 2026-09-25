// Contrato compartido de la "Fábrica de video UGC": lo usan la web (formulario,
// validación en el borde) y el worker del editor de video (armado del video).
// Los elementos visibles en el formulario espejan el catálogo de
// apps/video-editor/config/estilos/elementos — si se agrega uno allá que deba
// poder elegirse desde la página, se agrega también acá.

import { z } from "zod";

export const UGC_MODELS = [
  { id: "veo3.1-fast", label: "Veo 3.1 fast", detalle: "Voz y labios propios · tramo 8 s + extensión ≈ 14 s · ≈ US$0.28 por video" },
] as const;

export const UGC_COSTO_ESTIMADO_USD = 0.28;

export const TITULO_CLAVES = ["movistar-titulo-ola-pill", "movistar-titulo-ola", "movistar-titulo-pill-bitel"] as const;
export const PRECIO_CLAVES = ["movistar-precio-ilimitado", "movistar-pill-stack"] as const;
/**
 * Estilos de subtítulos (karaoke por palabra, alineados al guion exacto), tomados de los presets ya aprobados en
 * apps/video-editor/config/estilos/subtitulos: black-centro = AZ Black (una fila, Grift Black en mayúsculas, centrada,
 * con la firma de la marca debajo); abajo-az = el primero de AZ (Georgia, abajo, palabra activa celeste);
 * aura = Aura Studio (Georgia, palabra activa sobre pastilla naranja).
 */
export const SUBTITULO_ESTILOS = ["black-centro", "abajo-az", "aura"] as const;
export type SubtituloEstilo = (typeof SUBTITULO_ESTILOS)[number];

export const PALETAS_DESTELLO = ["frio", "calido", "blanco"] as const;

export const ugcElementosSchema = z.object({
  titulo: z
    .object({
      clave: z.enum(TITULO_CLAVES),
      /** Líneas del título: 2 para ola-pill / pill-bitel, 3 para titulo-ola. */
      lineas: z.array(z.string().trim().min(1).max(40)).min(2).max(3),
    })
    .nullable()
    .default(null),
  /** Segundos que dura el título en pantalla (aprobado: 3). */
  tituloDuracion: z.number().min(1).max(6).default(3),
  precio: z.object({ clave: z.enum(PRECIO_CLAVES) }).nullable().default(null),
  cta: z
    .object({
      clave: z.literal("movistar-cta-ola"),
      linea1: z.string().trim().min(1).max(20),
      linea2: z.string().trim().min(1).max(20),
    })
    .nullable()
    .default(null),
  whatsapp: z.boolean().default(false),
  destello: z.object({ paleta: z.enum(PALETAS_DESTELLO) }).nullable().default(null),
  /** Subtítulos por palabra. `marca` = firma fija bajo el subtítulo (solo estilo black-centro): texto editable y, opcional, el trozo en color de acento. */
  subtitulos: z
    .object({
      estilo: z.enum(SUBTITULO_ESTILOS),
      marca: z
        .object({
          texto: z.string().trim().max(40).default(""),
          acento: z.string().trim().max(20).default(""),
          colorAcento: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#E3B341"),
        })
        .default({ texto: "", acento: "", colorAcento: "#E3B341" }),
    })
    .nullable()
    .default(null),
  /**
   * Zona segura de Reels (1080x1920): x 68–1017, y 268–1255. Arriba queda la
   * cabecera de Reels y abajo la descripción y el botón; todo elemento va más
   * chico y hacia el centro, y el título inicial al centro (0.55) en vez de arriba.
   */
  zonaSegura: z.boolean().default(true),
  /**
   * Formato de salida: 9:16 (1080x1920) o 4:5 (1080x1350, recorte de la toma vertical). En 4:5
   * la zona segura es la que queda al ver el 4:5 centrado dentro de Reels: x 68–1017, y 40–970.
   */
  formato: z.enum(["9:16", "4:5"]).default("9:16"),
});
export type UgcElementos = z.infer<typeof ugcElementosSchema>;

export interface UgcElementoDef {
  /** Clave del catálogo (config/estilos/elementos/<clave>.json). */
  clave: string;
  grupo: "titulo" | "precio" | "cta" | "whatsapp" | "destello" | "subtitulos";
  etiqueta: string;
  descripcion: string;
  /** Cantidad de líneas de texto editables (0 si no lleva texto). */
  lineas: number;
}

export const UGC_ELEMENTOS_CATALOGO: UgcElementoDef[] = [
  { clave: "movistar-titulo-ola-pill", grupo: "titulo", etiqueta: "Título ola + pill", descripcion: "Línea de arriba en ola lenta y pill azul sólido abajo que entra con rebote.", lineas: 2 },
  { clave: "movistar-titulo-ola", grupo: "titulo", etiqueta: "Título ola (3 líneas)", descripcion: "Tres líneas donde cada letra rebota y luego ondula. Va abajo para no tapar la cara.", lineas: 3 },
  { clave: "movistar-titulo-pill-bitel", grupo: "titulo", etiqueta: "Título en pill escalonado", descripcion: "Pill azul con la línea 1 blanca y la 2 turquesa, con chispas en las esquinas.", lineas: 2 },
  { clave: "movistar-precio-ilimitado", grupo: "precio", etiqueta: "Precio: Plan desde S/39.90", descripcion: "Card azul con borde de luz. Entra cuando se dice el precio, siempre antes del CTA.", lineas: 0 },
  { clave: "movistar-pill-stack", grupo: "precio", etiqueta: "Precio: pill-stack", descripcion: "Tres pills pegados: Cámbiate a Movistar, Internet ilimitado y S/39.90.", lineas: 0 },
  { clave: "movistar-cta-ola", grupo: "cta", etiqueta: "CTA con flecha", descripcion: "Dos filas en ola lenta y la flecha hacia abajo. Va arriba del video.", lineas: 2 },
  { clave: "movistar-pill-whatsapp", grupo: "whatsapp", etiqueta: "Pill de WhatsApp", descripcion: "Pill verde con el ícono, abajo, desde que se dice el CTA hasta el final.", lineas: 0 },
  { clave: "movistar-transicion-destello", grupo: "destello", etiqueta: "Destello en el empalme", descripcion: "Lens flare con pico en el corte entre el tramo de 8 s y la extensión.", lineas: 0 },
  { clave: "black-centro", grupo: "subtitulos", etiqueta: "Subtítulos Black al centro + marca debajo", descripcion: "Una fila, máx. 3 palabras, Grift Black en mayúsculas, palabra activa en celeste, con el nombre de la marca debajo (editable).", lineas: 0 },
  { clave: "abajo-az", grupo: "subtitulos", etiqueta: "Subtítulos abajo (estilo AZ)", descripcion: "Georgia blanca con contorno, hasta 2 líneas, palabra activa en celeste. Sin nombre de marca.", lineas: 0 },
  { clave: "aura", grupo: "subtitulos", etiqueta: "Subtítulos Aura Studio", descripcion: "Georgia blanca con contorno; la palabra activa va amarilla sobre pastilla naranja.", lineas: 0 },
];

export const ELEMENTOS_POR_DEFECTO: UgcElementos = {
  titulo: { clave: "movistar-titulo-ola-pill", lineas: ["MISMO NÚMERO", "DESDE EL COLEGIO"] },
  tituloDuracion: 3,
  precio: { clave: "movistar-precio-ilimitado" },
  cta: { clave: "movistar-cta-ola", linea1: "ESCRÍBENOS", linea2: "POR WHATSAPP" },
  whatsapp: true,
  destello: { paleta: "frio" },
  subtitulos: null,
  zonaSegura: true,
  formato: "9:16",
};

/**
 * El precio se dice de corrido: escrito como número, el modelo hace una pausa
 * entre "treinta" y "y nueve"; escrito como palabra única sale fluido.
 */
export function normalizarGuionUgc(texto: string): string {
  return texto
    .replace(/S\/\s*39[.,]90/gi, "treintaynueve con noventa")
    .replace(/39[.,]90/g, "treintaynueve con noventa")
    .replace(/treinta y nueve con noventa/gi, "treintaynueve con noventa")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prompt aprobado: nunca lista de palabras a pronunciar (el modelo las lee en
 * voz alta) ni la palabra "subtitles" fuera de la negación; sin texto en pantalla.
 */
export function construirPromptUgc(escena: string, texto: string, continuacion: boolean): string {
  const cont = continuacion ? "Continue the same shot seamlessly, same woman, same framing, lighting and voice, without any cut. " : "";
  // Las notas de dirección (escena, acento, tono) van marcadas como NO hablables: el modelo tiende a leer en
  // voz alta cualquier descripción (m07 dijo "habla español, acento peruano, sea amable"). El diálogo va al final, solo entre comillas.
  return (
    `${cont}UGC selfie video, clean image with NO captions and NO subtitles at all: the woman in the image talks directly to the front camera ${escena}. ` +
    "DIRECTION NOTES, never to be spoken aloud: her voice is a young woman from Lima, Peru (Latin American accent, not a Spain accent), the same voice throughout. " +
    "Her hands never enter the frame, no other people, absolutely no on-screen text, no captions, no subtitles, no lyrics, no watermark, no music, no logos. " +
    "Lips perfectly synchronized, expressive natural face, subtle handheld shake. " +
    `The ONLY words she says, once, are exactly these: "${texto}" Then she stops talking and stays silent with a small smile until the end of the clip; she never says anything else.`
  );
}

export const ugcJobInputSchema = z
  .object({
    preset: z.literal("ugc").default("ugc"),
    nombre: z.string().trim().min(1).max(120),
    escena: z.string().trim().min(3).max(300),
    guionA: z.string().trim().min(5).max(300),
    guionB: z.string().trim().min(5).max(300),
    /** Primer cuadro ya hecho (se anima tal cual)… */
    framePath: z.string().min(1).optional(),
    /** …o una foto de REFERENCIA de la persona: el worker genera el primer cuadro (misma persona, otra ropa/escena) antes del video. */
    referenciaPath: z.string().min(1).optional(),
    /** Ropa/apariencia del primer cuadro generado (inglés). Vacío = la misma que en la referencia. */
    ropa: z.string().trim().max(200).optional(),
    elementos: ugcElementosSchema,
    model: z.enum(["veo3.1-fast"]).default("veo3.1-fast"),
  })
  .refine((j) => Boolean(j.framePath) !== Boolean(j.referenciaPath), { message: "sube el primer cuadro O una foto de referencia, no ambos ni ninguno" });
export type UgcJobInput = z.infer<typeof ugcJobInputSchema>;

// ───────────────────────── Preset "Situación con voz en off" ─────────────────────────
// Un comerciante en 4 tomas (imagen gpt-image-2 → video Seedance 1.0 Pro Fast 720p) con voz en off
// (ElevenLabs v3 por ID de voz, o un audio ya generado que se sube). Todo lo aprendido en el lote
// de comerciantes queda como reglas del prompt, no como algo que haya que recordar.

export const PRESETS = [
  { id: "ugc", label: "UGC (protagonista hablando)", detalle: "2 tomas de Veo: 8 s + extensión, destello en el empalme, voz y labios del modelo. ≈ US$0.28 por video." },
  { id: "situacion", label: "Situación con voz en off", detalle: "4 tomas de un comerciante + voz en off (ElevenLabs o audio propio). ≈ US$0.45 por video." },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];

export const SITUACION_COSTO_ESTIMADO_USD = 0.45;

/** Voces conocidas (ElevenLabs v3). La interfaz permite además pegar cualquier voice_id o subir un audio. */
export const VOCES_CONOCIDAS = [
  { id: "aZilAbZ5tl8i9lA1EF02", nombre: "Luisa (mujer)" },
  { id: "jBlmi27XRORxjPquUeCh", nombre: "Brian (hombre)" },
  { id: "aYQAm4rWuigkeuRA5i92", nombre: "Voz de la costurera" },
] as const;

/**
 * Tipo de cada toma: define las reglas de celular/vehículo que se agregan solas al prompt.
 *  - normal: sin celular a la vista.
 *  - celular-espalda: celular visto SOLO por atrás (funda de color + lentes), sin pantalla.
 *  - foto-pantalla: alguien fotografía algo y la pantalla SÍ se ve mostrando lo fotografiado.
 *  - vehiculo-lateral: moto/mototaxi en plano lateral de perfil, manubrio hacia adelante.
 *  - sin-hablar: nadie mueve los labios (toma de foto o de espera).
 */
export const TIPOS_TOMA = [
  { id: "normal", label: "Normal (sin celular)" },
  { id: "celular-espalda", label: "Celular de espaldas (funda de color, sin pantalla)" },
  { id: "foto-pantalla", label: "Toma una foto (se ve la pantalla con lo fotografiado)" },
  { id: "vehiculo-lateral", label: "Manejando (plano lateral de perfil)" },
] as const;
export type TipoToma = (typeof TIPOS_TOMA)[number]["id"];

export const situacionTomaSchema = z.object({
  /** Qué se ve, en inglés (ej.: "behind the counter of her grocery store arranging products"). */
  escena: z.string().trim().min(5).max(400),
  /** Movimiento de la toma, en inglés (ej.: "She arranges cans and turns to the camera; slow push-in"). */
  movimiento: z.string().trim().min(5).max(300),
  tipo: z.enum(["normal", "celular-espalda", "foto-pantalla", "vehiculo-lateral"]).default("normal"),
  /** true = persona distinta de la toma 1 (ej.: el pasajero del taxista): no usa la toma 1 como referencia. */
  otraPersona: z.boolean().default(false),
});
export type SituacionToma = z.infer<typeof situacionTomaSchema>;

export const situacionSchema = z.object({
  /** Descripción del personaje en inglés (ej.: "a Peruvian woman in her 50s, apron, owner of a grocery store"). */
  personaje: z.string().trim().min(5).max(300),
  /** Texto de la voz en off, con etiquetas expresivas de ElevenLabs v3 ([worried], [excited]…). */
  guion: z.string().trim().min(20).max(900),
  voz: z.discriminatedUnion("origen", [
    z.object({
      origen: z.literal("elevenlabs"),
      voiceId: z.string().trim().min(10).max(40),
      /** v3 entiende las etiquetas expresivas; v2 (multilingual) es más estable y las etiquetas se ignoran. */
      modelo: z.enum(["v3", "v2"]).default("v3"),
    }),
    /** Audio ya generado, subido por el usuario a video-editor-assets. */
    z.object({ origen: z.literal("audio"), audioPath: z.string().min(1) }),
  ]),
  /** 1 = tal cual; 1.1 = +10 % de velocidad sin cambiar el tono (para calzar el audio con el video). */
  velocidad: z.number().min(0.8).max(1.3).default(1),
  tomas: z.array(situacionTomaSchema).length(4),
  /** Segundos que dura el video tras la última palabra (0.5 por defecto; 0.05 = justo al terminar). */
  colaSeg: z.number().min(0).max(2).default(0.5),
});
export type Situacion = z.infer<typeof situacionSchema>;

const REGLA_SIN_DINERO =
  "No money, no coins, no banknotes, no receipts or papers with amounts anywhere in the frame.";

const REGLAS_TIPO: Record<TipoToma, string> = {
  normal: "No smartphone screen is visible anywhere.",
  "celular-espalda":
    "Any smartphone is seen ONLY from its back: a bright colored silicone case (teal, red or blue, never plain black) with a clearly visible camera module with two round lenses in a corner; NEVER show a screen, light or image on the phone.",
  "foto-pantalla":
    "The person takes a photo with the smartphone held up in front of them (medium close-up, never from far away): the phone screen faces the camera and clearly shows the camera viewfinder with the subject being photographed. Exactly two hands.",
  "vehiculo-lateral":
    "Side-profile view of the vehicle and rider, both hands on the handlebar in front of the rider, the handlebar pointing forward in the direction of travel, realistic vehicle geometry.",
};

const SFX_IMAGEN =
  "Photorealistic commercial photo, candid, natural skin texture, natural light, Lima Peru, vertical composition. No legible text, no logos, no watermarks.";

const SFX_ANIMACION =
  "Image-to-video, realistic motion and physics, keep the face and identity exactly consistent with the first frame, no morphing, no extra fingers, no added text or logos, natural lighting preserved.";

/** Prompt de la imagen de una toma. La toma 1 no lleva referencia; las demás usan la 1 para mantener a la misma persona. */
export function promptImagenSituacion(s: Situacion, i: number): string {
  const t = s.tomas[i]!;
  const base = i === 0 || t.otraPersona
    ? `${s.personaje}, ${t.escena}.`
    : `Use the person in the reference photo as the SAME person: identical face, age, hair, skin tone and clothing. New photo: ${t.escena}.`;
  return `${base} ${REGLA_SIN_DINERO} ${REGLAS_TIPO[t.tipo]} Exactly two arms and two hands. ${SFX_IMAGEN}`;
}

/** Prompt del movimiento. La voz va en off: nadie habla, salvo que la escena lo pida explícitamente. */
export function promptAnimacionSituacion(t: SituacionToma): string {
  const silencio = "Nobody speaks: mouths stay closed, the audio is a voice-over.";
  return `${t.movimiento}. ${silencio} ${t.tipo === "celular-espalda" ? "The back of the phone never turns around. " : ""}${SFX_ANIMACION}`;
}

export const situacionJobInputSchema = z.object({
  preset: z.literal("situacion"),
  nombre: z.string().trim().min(1).max(120),
  situacion: situacionSchema,
  elementos: ugcElementosSchema,
});
export type SituacionJobInput = z.infer<typeof situacionJobInputSchema>;

export const jobInputSchema = z.union([ugcJobInputSchema, situacionJobInputSchema]);

export const COSTO_PRIMER_CUADRO_USD = 0.03;

/**
 * Primer cuadro de un video UGC generado desde una foto de referencia (gpt-image-2, con la referencia como imagen de entrada):
 * misma persona, ropa/escena nuevas, selfie de hombros hacia arriba, sin manos (las manos deformadas fueron un defecto recurrente).
 */
export function promptPrimerCuadroUgc(escena: string, ropa: string | undefined): string {
  const vestimenta = ropa && ropa.trim() ? `wearing ${ropa.trim()}` : "wearing exactly the same outfit as in the reference photo";
  return (
    "Use the person in the reference photo as the SAME person: identical face, age, skin tone, hair and any glasses or accessories. " +
    `New photo of them ${vestimenta}, ${escena}. ` +
    "UGC selfie-style vertical video frame, shot from arm's length: head and shoulders with a little space above the head, they look straight at the front camera with the mouth slightly open mid-sentence, natural skin, candid smartphone look. " +
    "Only head, shoulders and chest are visible; NO hands visible in the frame. Exactly one person, no other people in the foreground. " +
    "No money, no legible text other than a logo already present on the clothing, no watermarks. Photorealistic, natural light, Lima Peru."
  );
}
