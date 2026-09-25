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

import { promptAnimacionSituacion, promptImagenSituacion, situacionSchema } from "../src/ugc.js";

const sit = situacionSchema.parse({
  personaje: "a Peruvian woman in her 50s, apron, owner of a grocery store",
  guion: "[calm] Atiendo todo el día. [upbeat] Con Movistar, internet ilimitado por treintaynueve con noventa.",
  voz: { origen: "elevenlabs", voiceId: "aZilAbZ5tl8i9lA1EF02" },
  tomas: [
    { escena: "behind the counter arranging products", movimiento: "She arranges cans; slow push-in" },
    { escena: "photographing a dress with her phone", movimiento: "She taps to take the photo", tipo: "foto-pantalla" },
    { escena: "a customer at the counter", movimiento: "She hands over a bag", otraPersona: true },
    { escena: "smiling at her phone", movimiento: "She smiles; static camera", tipo: "celular-espalda" },
  ],
});

describe("preset situación", () => {
  it("nunca deja pasar dinero y usa la toma 1 como referencia en las siguientes", () => {
    expect(promptImagenSituacion(sit, 0)).toMatch(/No money, no coins, no banknotes/);
    expect(promptImagenSituacion(sit, 0)).toContain("Peruvian woman");
    expect(promptImagenSituacion(sit, 1)).toMatch(/SAME person/);
  });
  it("una persona distinta (otraPersona) no usa la referencia", () => {
    expect(promptImagenSituacion(sit, 2)).not.toMatch(/SAME person/);
    expect(promptImagenSituacion(sit, 2)).toContain("Peruvian woman");
  });
  it("aplica la regla de celular según el tipo de toma", () => {
    expect(promptImagenSituacion(sit, 1)).toMatch(/viewfinder/);
    expect(promptImagenSituacion(sit, 3)).toMatch(/ONLY from its back.*silicone case/);
    expect(promptImagenSituacion(sit, 0)).toMatch(/No smartphone screen/);
  });
  it("el movimiento pide boca cerrada porque la voz va en off", () => {
    expect(promptAnimacionSituacion(sit.tomas[0]!)).toMatch(/mouths stay closed/);
    expect(promptAnimacionSituacion(sit.tomas[3]!)).toMatch(/never turns around/);
  });
  it("exige 4 tomas y una velocidad razonable", () => {
    expect(() => situacionSchema.parse({ ...sit, tomas: sit.tomas.slice(0, 3) })).toThrow();
    expect(() => situacionSchema.parse({ ...sit, velocidad: 2 })).toThrow();
  });
});
