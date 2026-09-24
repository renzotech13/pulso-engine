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
  grupo: "titulo" | "precio" | "cta" | "whatsapp" | "destello";
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
];

export const ELEMENTOS_POR_DEFECTO: UgcElementos = {
  titulo: { clave: "movistar-titulo-ola-pill", lineas: ["MISMO NÚMERO", "DESDE EL COLEGIO"] },
  tituloDuracion: 3,
  precio: { clave: "movistar-precio-ilimitado" },
  cta: { clave: "movistar-cta-ola", linea1: "ESCRÍBENOS", linea2: "POR WHATSAPP" },
  whatsapp: true,
  destello: { paleta: "frio" },
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
  const cont = continuacion ? "Continue the same shot seamlessly, same woman, same framing, lighting, and EXACTLY the same voice, tone and Peruvian accent as before, without any cut. " : "";
  return (
    `${cont}UGC selfie video, clean image with NO captions and NO subtitles at all: the woman in the image talks directly to the front camera ${escena}. ` +
    `She speaks in clear, natural Spanish with a neutral Latin American accent, saying exactly this and nothing else: "${texto}" ` +
    "Say ONLY the quoted words, once, then stop talking and stay silent with a small smile until the end of the clip; never read any other words. " +
    "Lips perfectly synchronized, expressive natural face, subtle handheld shake. " +
    "Her hands never enter the frame, no other people, absolutely no on-screen text, no captions, no subtitles, no lyrics, no watermark, no music, no logos."
  );
}

export const ugcJobInputSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  escena: z.string().trim().min(3).max(300),
  guionA: z.string().trim().min(5).max(300),
  guionB: z.string().trim().min(5).max(300),
  framePath: z.string().min(1),
  elementos: ugcElementosSchema,
  model: z.enum(["veo3.1-fast"]).default("veo3.1-fast"),
});
export type UgcJobInput = z.infer<typeof ugcJobInputSchema>;
