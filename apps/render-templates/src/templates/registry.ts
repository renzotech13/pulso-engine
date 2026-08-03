import { SocialPostTemplate, SOCIAL_POST_SIZE, type SocialPostProps } from "./social-post";
import { CarouselTemplate, CAROUSEL_SIZE, type CarouselProps } from "./carousel";
import { PhotoFrameTemplate, type PhotoFrameProps } from "./photo-frame";

/**
 * Maps render_templates.component_ref (a plain string in the DB) to the
 * actual component. Adding a template is: build the component, add one line
 * here (and to TEMPLATE_SIZES), insert the render_templates row — no other
 * wiring.
 */
export const TEMPLATE_REGISTRY = {
  "social-post": SocialPostTemplate,
  carousel: CarouselTemplate,
  "photo-frame": PhotoFrameTemplate,
} satisfies Record<string, (props: never) => React.JSX.Element>;

// Puppeteer's viewport has to match each template's fixed pixel size exactly.
// "photo-frame" is the one exception: its canvas size is chosen per tenant
// (stored on its render_templates row, not fixed in code), so this entry is
// a nominal placeholder never actually read at runtime — route.ts resolves
// the real size from the DB before it ever consults this map.
export const TEMPLATE_SIZES = {
  "social-post": SOCIAL_POST_SIZE,
  carousel: CAROUSEL_SIZE,
  "photo-frame": { width: 1080, height: 1080 },
} satisfies Record<keyof typeof TEMPLATE_REGISTRY, { width: number; height: number }>;

export type TemplateRef = keyof typeof TEMPLATE_REGISTRY;

export function isKnownTemplateRef(ref: string): ref is TemplateRef {
  return ref in TEMPLATE_REGISTRY;
}

export type { SocialPostProps, CarouselProps, PhotoFrameProps };
