import { z } from "zod";

// Same shape as SocialPostTemplate's BrandKitProps in render-templates —
// duplicated on purpose, these two packages don't share a dependency.
export const brandSchema = z.object({
  logoUrl: z.string().nullable(),
  colorPrimary: z.string(),
  colorSecondary: z.string(),
  tenantName: z.string(),
});

export type Brand = z.infer<typeof brandSchema>;
