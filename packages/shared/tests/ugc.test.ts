import { describe, expect, it } from "vitest";
import { construirPromptUgc, normalizarGuionUgc, ugcElementosSchema } from "../src/ugc.js";

describe("normalizarGuionUgc", () => {
  it("escribe el precio como una sola palabra para que no haya pausa", () => {
    expect(normalizarGuionUgc("Internet por S/39.90 al mes")).toBe("Internet por treintaynueve con noventa al mes");
    expect(normalizarGuionUgc("por 39,90 soles")).toBe("por treintaynueve con noventa soles");
    expect(normalizarGuionUgc("por treinta y nueve con noventa")).toBe("por treintaynueve con noventa");
  });
});

describe("construirPromptUgc", () => {
  it("no lista palabras a pronunciar y marca la continuación", () => {
    const p = construirPromptUgc("in her kitchen", "Hola", true);
    expect(p).not.toMatch(/pronounce/i);
    expect(p).toMatch(/^Continue the same shot/);
    expect(p).toContain('"Hola"');
  });
});

describe("ugcElementosSchema", () => {
  it("aplica los valores por defecto", () => {
    const e = ugcElementosSchema.parse({});
    expect(e.titulo).toBeNull();
    expect(e.tituloDuracion).toBe(3);
    expect(e.whatsapp).toBe(false);
  });
  it("rechaza un título con una sola línea", () => {
    expect(() => ugcElementosSchema.parse({ titulo: { clave: "movistar-titulo-ola", lineas: ["SOLO UNA"] } })).toThrow();
  });
});
