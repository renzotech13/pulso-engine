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
      artDirection: "azul marino y camel, emprendedores reales",
    });
    expect(prompt.indexOf("Dirección de arte")).toBeLessThan(prompt.indexOf("Composición:"));
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
    const news = buildNewsImagePrompt({ rubro: "estudio_contable", theme: "t", headline: "SUNAT pide pruebas", artDirection: "marca" });
    const slide = buildCarouselSlideImagePrompt({ rubro: "estudio_contable", theme: "t", slideText: "Paso 1", artDirection: "marca" });
    for (const prompt of [news, slide]) {
      expect(prompt.endsWith(NO_TEXT_IN_IMAGE)).toBe(true);
      expect(prompt.indexOf("Dirección de arte")).toBeLessThan(prompt.indexOf(NO_TEXT_IN_IMAGE));
    }
    expect(news).toContain('"SUNAT pide pruebas"');
    expect(slide).toContain("sin escribirlo: Paso 1");
  });
});

describe("no-text rule", () => {
  it("is the last thing the model reads and states the ban unconditionally", () => {
    const prompt = buildPostImagePrompt({ rubro: "estudio_contable", theme: "t", artDirection: "azul marino" });
    expect(prompt.endsWith(NO_TEXT_IN_IMAGE)).toBe(true);
    expect(NO_TEXT_IN_IMAGE).toContain("NI UNA SOLA LETRA");
  });

  it("caps the art direction so the ban can't be buried under a wall of brand text", () => {
    const huge = "paleta azul. ".repeat(500);
    const prompt = buildPostImagePrompt({ rubro: "x", theme: "t", artDirection: huge });
    expect(prompt.length).toBeLessThan(2500);
    expect(prompt.endsWith(NO_TEXT_IN_IMAGE)).toBe(true);
  });
});
