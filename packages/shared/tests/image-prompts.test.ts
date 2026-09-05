import { describe, expect, it } from "vitest";
import {
  NO_TEXT_IN_IMAGE,
  buildCarouselSlideImagePrompt,
  buildNewsImagePrompt,
  buildPostImagePrompt,
} from "../src/image-prompts.js";

describe("buildPostImagePrompt", () => {
  it("puts the brand block before the default composition and drops the old corporate style line", () => {
    const prompt = buildPostImagePrompt({
      rubro: "estudio_contable",
      theme: "RUC 10 vs RUC 20",
      brandTraining: "azul marino y camel, emprendedores reales",
    });
    expect(prompt.indexOf("Indicaciones de la marca")).toBeLessThan(prompt.indexOf("Composición:"));
    expect(prompt).not.toContain("Estilo limpio y corporativo");
    expect(prompt.endsWith(NO_TEXT_IN_IMAGE)).toBe(true);
  });

  it("includes headline, keywords and ephemeris hint only when given", () => {
    const bare = buildPostImagePrompt({ rubro: "spa", theme: "Relajación" });
    expect(bare).not.toContain("Concepto a ilustrar");
    expect(bare).not.toContain("Escena sugerida");

    const full = buildPostImagePrompt({
      rubro: "spa",
      theme: "Relajación",
      headline: "Tu momento de calma",
      keywords: [" masajista ", "", "camilla"],
      ephemerisHint: "Usa colores rojo y blanco.",
    });
    expect(full).toContain("Concepto a ilustrar visualmente, sin escribirlo: Tu momento de calma.");
    expect(full).toContain("Escena sugerida: masajista, camilla.");
    expect(full).toContain("Usa colores rojo y blanco.");
  });
});

describe("buildNewsImagePrompt / buildCarouselSlideImagePrompt", () => {
  it("keeps the no-text rule last, after the brand block", () => {
    const news = buildNewsImagePrompt({ rubro: "estudio_contable", theme: "t", headline: "SUNAT pide pruebas", brandTraining: "marca" });
    const slide = buildCarouselSlideImagePrompt({ rubro: "estudio_contable", theme: "t", slideText: "Paso 1", brandTraining: "marca" });
    for (const prompt of [news, slide]) {
      expect(prompt.endsWith(NO_TEXT_IN_IMAGE)).toBe(true);
      expect(prompt.indexOf("Indicaciones de la marca")).toBeLessThan(prompt.indexOf(NO_TEXT_IN_IMAGE));
    }
    expect(news).toContain('"SUNAT pide pruebas"');
    expect(slide).toContain("sin escribirlo: Paso 1");
  });
});
