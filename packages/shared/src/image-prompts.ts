// Single home for every image-generation prompt. Until now the same base
// text lived in three hand-copied places (creative.ts twice, the dashboard's
// per-slide regenerate action once) and they had already drifted: the post
// prompt asked Gemini for a "clean corporate style" while the tenant's own
// art direction — appended after it — asked for the opposite. The brand
// block now comes FIRST and the default style line is gone.
//
// No relative imports here on purpose: apps/web bundles this module too (see
// the note at the top of image-gen.ts).

/**
 * Two separate failure modes seen on real Mohrroce posts, both from the image
 * model trying to *illustrate the concept* instead of just photographing a
 * scene: a fake magazine cover with garbled Spanish body copy, and — when the
 * theme mentioned "los 4 sectores" — a labelled infographic with misspelled
 * English captions under each icon. Banning text alone wasn't enough, since
 * the model still reached for the diagram layout and then labelled it, so the
 * composition itself has to be ruled out too. Shared by every prompt that
 * generates a photo meant to sit *behind* our own text overlay.
 */
export const NO_TEXT_IN_IMAGE =
  "REGLA ABSOLUTA: la imagen no puede contener NI UNA SOLA LETRA. Cero texto, palabras, titulares, frases, firmas, nombres, botones, carteles, etiquetas, marcas de agua o logos con letras, en ningún idioma. Si algo en las instrucciones de arriba parece una frase para escribir, NO se escribe: es solo contexto de qué fotografiar. Una sola escena fotográfica real, capturada con cámara. Prohibido además: portadas de revista, periódicos o artículos simulados; infografías, diagramas, collages, cuadrículas, paneles divididos, maquetas 3D, iconos, pictogramas o elementos etiquetados. Nada de composiciones que expliquen o enumeren conceptos: solo una fotografía única y natural, sin texto.";

// Hard cap on what reaches an image model. The full brand training is a
// COPYWRITING manual (CTAs, signatures, brand sign-offs); handing 11.000
// characters of it to Gemini got those very phrases painted into a real
// published post, misspelled. Only art direction belongs here, and even
// that is trimmed so the no-text rule can't get buried again.
const MAX_ART_DIRECTION_CHARS = 1200;

function brandBlock(artDirection: string | undefined): string {
  const text = artDirection?.trim().slice(0, MAX_ART_DIRECTION_CHARS);
  return text ? ` Dirección de arte de la marca (solo aspecto visual): ${text}.` : "";
}

function joinParts(parts: Array<string | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" ");
}

export interface PostImagePromptInput {
  rubro: string;
  theme: string;
  /** The copy's own headline — the visual concept, never text to draw. */
  headline?: string | undefined;
  /** 3-6 loose scene words the copywriter suggested (people, place, objects). */
  keywords?: readonly string[] | undefined;
  ephemerisHint?: string | undefined;
  /** ONLY art direction — never the copywriting voice. See brandBlock. */
  artDirection?: string | undefined;
}

export function buildPostImagePrompt(input: PostImagePromptInput): string {
  const keywords = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  return joinParts([
    `Fotografía real de marketing para un negocio de tipo "${input.rubro}".${brandBlock(input.artDirection)}`,
    `Tema de la publicación: ${input.theme}.`,
    input.headline?.trim() && `Concepto a ilustrar visualmente, sin escribirlo: ${input.headline.trim()}.`,
    keywords.length > 0 && `Escena sugerida: ${keywords.join(", ")}.`,
    input.ephemerisHint?.trim(),
    `Composición: una sola escena natural con personas reales en un contexto real, luz natural, encuadre lleno de borde a borde sin zonas vacías (el texto se superpone después). Sin logos. ${NO_TEXT_IN_IMAGE}`,
  ]);
}

export interface NewsImagePromptInput {
  rubro: string;
  theme: string;
  headline: string;
  /** ONLY art direction — never the copywriting voice. See brandBlock. */
  artDirection?: string | undefined;
}

export function buildNewsImagePrompt(input: NewsImagePromptInput): string {
  return joinParts([
    `Fotografía profesional y editorial para una publicación de noticias sobre: "${input.headline}".`,
    `Enfoque para este negocio (${input.rubro}): ${input.theme}.`,
    `Estilo fotoperiodístico, realista, sin logos.${brandBlock(input.artDirection)}`,
    NO_TEXT_IN_IMAGE,
  ]);
}

export interface CarouselSlideImagePromptInput {
  rubro: string;
  theme: string;
  slideText: string;
  /** ONLY art direction — never the copywriting voice. See brandBlock. */
  artDirection?: string | undefined;
}

export function buildCarouselSlideImagePrompt(input: CarouselSlideImagePromptInput): string {
  return joinParts([
    `Fotografía temática para UN slide de un carrusel de Instagram/Facebook, para un negocio de tipo "${input.rubro}".`,
    `Tema general del carrusel: ${input.theme}.`,
    // Deliberately NOT quoted as «este slide dice "..."» — with that wording
    // the model understood the phrase had to appear written and drew it
    // inside the photo, misspelled (seen on a real carousel). Here the
    // phrase is only context for what to illustrate.
    `Concepto a ilustrar visualmente, sin escribirlo: ${input.slideText}`,
    `La imagen debe transmitir esa idea de forma puramente visual, ocupando el 100% del encuadre de borde a borde, sin zonas vacías, planas ni espacios en blanco reservados (el overlay de texto se agrega después por separado, en post-producción). Sin logos.${brandBlock(input.artDirection)}`,
    NO_TEXT_IN_IMAGE,
  ]);
}
