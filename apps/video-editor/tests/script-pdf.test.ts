import { describe, expect, it } from "vitest";
import { parseByHeadings } from "../src/pipeline/script-pdf.js";

describe("parseByHeadings", () => {
  it("splits on 'Video N' headers and reads an explicit Título line", () => {
    const doc = parseByHeadings(
      `Video 1\nTítulo: Formaliza tu negocio\nHoy te explico como sacar tu RUC.\n\nVideo 2\nTítulo: Evita multas\nEsta es la multa que nadie te explica.`,
    );

    expect(doc.videos).toHaveLength(2);
    expect(doc.videos[0]).toMatchObject({
      id: "video-1",
      titulo: "Formaliza tu negocio",
      mostrarTitulo: true,
      necesitaRevision: false,
    });
    expect(doc.videos[0]!.guion).toContain("Hoy te explico");
    expect(doc.videos[1]!.titulo).toBe("Evita multas");
  });

  it("treats the whole document as one video when there are no headers", () => {
    const doc = parseByHeadings("Este es un guion suelto sin encabezados ni título.");
    expect(doc.videos).toHaveLength(1);
    expect(doc.videos[0]!.id).toBe("video-1");
  });

  it("flags a block with no Título line for manual review, without dropping its script", () => {
    const doc = parseByHeadings("Video 1\nEste guion no trae un título explícito.");
    expect(doc.videos[0]!.necesitaRevision).toBe(true);
    expect(doc.videos[0]!.mostrarTitulo).toBe(false);
    expect(doc.videos[0]!.guion).toContain("no trae un título");
  });

  it("tolerates 'Guion N' and 'GUION N:' as header variants", () => {
    const doc = parseByHeadings("GUION 1:\nTítulo: Uno\nContenido uno.\n\nGuion 2\nTítulo: Dos\nContenido dos.");
    expect(doc.videos).toHaveLength(2);
    expect(doc.videos[1]!.titulo).toBe("Dos");
  });

  it("reads a 'Carpeta:' line and keeps escenas empty when there are no 'Escena N:' headers", () => {
    const doc = parseByHeadings("Video 1\nTítulo: Uno\nCarpeta: ADS-01\nContenido sin escenas explícitas.");
    expect(doc.videos[0]!.carpetaTomas).toBe("ADS-01");
    expect(doc.videos[0]!.escenas).toEqual([]);
    expect(doc.videos[0]!.guion).toContain("Contenido sin escenas");
    expect(doc.videos[0]!.guion).not.toContain("Carpeta");
  });

  it("splits into escenas with their visual requisitos from bracket tags", () => {
    const doc = parseByHeadings(
      "Video 1\nTítulo: Uno\nCarpeta: ADS-01\n\n" +
        "Escena 1:\n¡Sigues viniendo con tu DNI a hacer filas en la SUNAT?\n\n" +
        "Escena 2: [fondo: sunat]\nNosotros lo hacemos por ti, sin que salgas de tu casa.\n\n" +
        "Escena 3: [apoyo: oficina]\nEn AZ Estudio Contable llevamos años ayudando a negocios.",
    );

    const escenas = doc.videos[0]!.escenas;
    expect(escenas).toHaveLength(3);
    expect(escenas[0]).toMatchObject({ numero: 1, requisitos: [] });
    expect(escenas[0]!.texto).toContain("hacer filas en la SUNAT");
    expect(escenas[1]).toMatchObject({
      numero: 2,
      requisitos: [{ tipo: "fondo", referencia: "sunat" }],
    });
    expect(escenas[2]).toMatchObject({
      numero: 3,
      requisitos: [{ tipo: "apoyo", referencia: "oficina" }],
    });
    // El guion plano sigue sin los encabezados/corchetes, para no romper el
    // matching de transcripción existente.
    expect(doc.videos[0]!.guion).not.toContain("Escena");
    expect(doc.videos[0]!.guion).not.toContain("[fondo");
  });

  it("supports more than one requisito on the same escena header", () => {
    const doc = parseByHeadings(
      "Video 1\nTítulo: Uno\nEscena 1: [fondo: sunat] [apoyo: oficina]\nAlgo se dice acá.",
    );
    expect(doc.videos[0]!.escenas[0]!.requisitos).toEqual([
      { tipo: "fondo", referencia: "sunat" },
      { tipo: "apoyo", referencia: "oficina" },
    ]);
  });
});
