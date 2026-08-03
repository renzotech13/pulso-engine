import { notFound } from "next/navigation";
import { z } from "zod";
import { getCreativeForRender, getPhotoFrameConfig, resolveBrand } from "@/lib/data";
import { isKnownTemplateRef, TEMPLATE_REGISTRY } from "@/templates/registry";

// What the Creative agent's brief must contain for this specific template —
// each template ref will have its own schema here as more get added.
const socialPostBriefSchema = z.object({
  headline: z.string().min(1),
  subheadline: z.string().optional(),
  priceLabel: z.string().optional(),
  photoUrl: z.string().url().optional(),
  // Ephemeris-driven accent colors (creative.ts) — override the tenant's own
  // brand colors for just this one piece when both are present.
  colorPrimary: z.string().optional(),
  colorSecondary: z.string().optional(),
});

const carouselBriefSchema = z.object({
  slides: z.array(z.string().min(1)).min(5).max(7),
  photoUrl: z.string().url().optional(),
  colorPrimary: z.string().optional(),
  colorSecondary: z.string().optional(),
});

// exactOptionalPropertyTypes rejects spreading Zod's `optional()` output
// (which types absent fields as `| undefined`) into props typed as plain
// `field?: string` — strip the undefined-valued keys instead of just omitting them.
function omitUndefined<T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as never;
}

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ creative?: string; slide?: string; photo?: string }>;
}) {
  const { templateId } = await params;
  const { creative: creativeId, slide, photo } = await searchParams;

  if (!isKnownTemplateRef(templateId) || !creativeId) notFound();

  const result = await getCreativeForRender(creativeId);
  if (!result) notFound();

  const { creative, brandKit, tenantName } = result;

  if (templateId === "social-post") {
    const brief = socialPostBriefSchema.safeParse(creative.brief);
    if (!brief.success) notFound();

    const { colorPrimary, colorSecondary, ...templateProps } = brief.data;
    const brand = {
      ...resolveBrand(brandKit, tenantName),
      ...(colorPrimary && colorSecondary ? { colorPrimary, colorSecondary } : {}),
    };

    const Component = TEMPLATE_REGISTRY["social-post"];
    return <Component brand={brand} {...omitUndefined(templateProps)} />;
  }

  if (templateId === "carousel") {
    const brief = carouselBriefSchema.safeParse(creative.brief);
    if (!brief.success) notFound();

    const slideIndex = Number(slide ?? "0");
    if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= brief.data.slides.length) {
      notFound();
    }

    const { colorPrimary, colorSecondary, slides, photoUrl } = brief.data;
    const brand = {
      ...resolveBrand(brandKit, tenantName),
      ...(colorPrimary && colorSecondary ? { colorPrimary, colorSecondary } : {}),
    };

    const Component = TEMPLATE_REGISTRY["carousel"];
    return (
      <Component
        brand={brand}
        slides={slides}
        slideIndex={slideIndex}
        {...omitUndefined({ photoUrl })}
      />
    );
  }

  if (templateId === "photo-frame") {
    if (!photo || !creative.template_id) notFound();

    const config = await getPhotoFrameConfig(creative.template_id);
    if (!config) notFound();

    const Component = TEMPLATE_REGISTRY["photo-frame"];
    return (
      <Component
        photoUrl={photo}
        frameUrl={config.frameImageUrl}
        width={config.width}
        height={config.height}
      />
    );
  }

  notFound();
}
