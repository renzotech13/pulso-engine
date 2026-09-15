import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEscenaTreatments, escenaNumberForFile } from "../src/pipeline/escena-treatment.js";
import type { BRollLibrary } from "../src/pipeline/b-roll.js";

describe("escenaNumberForFile", () => {
  it("reads the escena number regardless of what else is in the filename", () => {
    expect(escenaNumberForFile("/x/ADS-01-ESCENA-04.MP4")).toBe(4);
    expect(escenaNumberForFile("/x/BLOQUE-02-ADS-04-ESCENA-02.MP4")).toBe(2);
    expect(escenaNumberForFile("/x/ADS-01-ESCENA-03-PARTE-01.MP4")).toBe(3);
  });

  it("returns undefined for a file with no escena marker", () => {
    expect(escenaNumberForFile("/x/sunat-clientes-caminando.mp4")).toBeUndefined();
  });
});

describe("applyEscenaTreatments", () => {
  let workDir: string;
  let libraryPath: string;

  async function writeLibrary(library: BRollLibrary): Promise<void> {
    await writeFile(libraryPath, JSON.stringify(library), "utf8");
  }

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "pulso-video-editor-escena-treatment-"));
    libraryPath = path.join(workDir, "b-roll.json");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("passes a video through untouched when it has no recognizable escena number", async () => {
    await writeLibrary({ cliente: "test", tomas: [] });
    const result = await applyEscenaTreatments(
      ["/x/sunat-clientes-caminando.mp4"],
      [{ numero: 1, texto: "algo", requisitos: [{ tipo: "fondo", referencia: "sunat" }] }],
      { bRollLibraryPath: libraryPath, workDir },
    );
    expect(result).toEqual(["/x/sunat-clientes-caminando.mp4"]);
  });

  it("passes a video through untouched when its escena has no requisitos", async () => {
    await writeLibrary({ cliente: "test", tomas: [] });
    const result = await applyEscenaTreatments(
      ["/x/ADS-01-ESCENA-01.MP4"],
      [{ numero: 1, texto: "algo", requisitos: [] }],
      { bRollLibraryPath: libraryPath, workDir },
    );
    expect(result).toEqual(["/x/ADS-01-ESCENA-01.MP4"]);
  });

  it("skips a requisito whose referencia doesn't match any b-roll, without throwing", async () => {
    await writeLibrary({ cliente: "test", tomas: [] });
    const result = await applyEscenaTreatments(
      ["/x/ADS-01-ESCENA-04.MP4"],
      [{ numero: 4, texto: "algo", requisitos: [{ tipo: "fondo", referencia: "sunat" }] }],
      { bRollLibraryPath: libraryPath, workDir },
    );
    expect(result).toEqual(["/x/ADS-01-ESCENA-04.MP4"]);
  });

  it("skips a b-roll match that isn't marked listo, without throwing", async () => {
    await writeLibrary({
      cliente: "test",
      tomas: [
        {
          id: "sunat-pendiente",
          archivo: "assets/b-roll/test/sunat-pendiente.mp4",
          listo: false,
          escena: "sunat",
          etiquetas: [],
          conAudio: false,
          correccionColorAplicada: false,
          fuente: { archivoOriginal: "/x/original.mp4", inicioSeg: 0, finSeg: 5 },
        },
      ],
    });
    const result = await applyEscenaTreatments(
      ["/x/ADS-01-ESCENA-04.MP4"],
      [{ numero: 4, texto: "algo", requisitos: [{ tipo: "fondo", referencia: "sunat" }] }],
      { bRollLibraryPath: libraryPath, workDir },
    );
    expect(result).toEqual(["/x/ADS-01-ESCENA-04.MP4"]);
  });

  it("skips a 'fondo' requisito when no rvmModelPath is configured, without throwing", async () => {
    await writeLibrary({
      cliente: "test",
      tomas: [
        {
          id: "sunat-listo",
          archivo: "assets/b-roll/test/sunat-listo.mp4",
          listo: true,
          escena: "sunat",
          etiquetas: [],
          conAudio: false,
          correccionColorAplicada: false,
          fuente: { archivoOriginal: "/x/original.mp4", inicioSeg: 0, finSeg: 5 },
        },
      ],
    });
    const result = await applyEscenaTreatments(
      ["/x/ADS-01-ESCENA-04.MP4"],
      [{ numero: 4, texto: "algo", requisitos: [{ tipo: "fondo", referencia: "sunat" }] }],
      { bRollLibraryPath: libraryPath, workDir },
    );
    expect(result).toEqual(["/x/ADS-01-ESCENA-04.MP4"]);
  });

  it("reuses an already-treated file instead of re-running ffmpeg (RVM is expensive — this must not redo it on every re-render)", async () => {
    await writeLibrary({
      cliente: "test",
      tomas: [
        {
          id: "sunat-listo",
          archivo: "assets/b-roll/test/sunat-listo.mp4",
          listo: true,
          escena: "sunat",
          etiquetas: [],
          conAudio: false,
          correccionColorAplicada: false,
          fuente: { archivoOriginal: "/x/original.mp4", inicioSeg: 0, finSeg: 5 },
        },
      ],
    });
    const treatedPath = path.join(workDir, "ADS-01-ESCENA-04-fondo-sunat-listo.mp4");
    await writeFile(treatedPath, ""); // simula un tratamiento previo ya en disco

    // La toma "original" y el b-roll NO existen de verdad — si esto llamara
    // a ffmpeg fallaría. Que no falle prueba que usó el cache.
    const result = await applyEscenaTreatments(
      ["/x/ADS-01-ESCENA-04.MP4"],
      [{ numero: 4, texto: "algo", requisitos: [{ tipo: "fondo", referencia: "sunat" }] }],
      { bRollLibraryPath: libraryPath, workDir, rvmModelPath: "/fake/model.onnx" },
    );
    expect(result).toEqual([treatedPath]);
  });

  it("skips an unrecognized requisito tipo, without throwing", async () => {
    await writeLibrary({
      cliente: "test",
      tomas: [
        {
          id: "sunat-listo",
          archivo: "assets/b-roll/test/sunat-listo.mp4",
          listo: true,
          escena: "sunat",
          etiquetas: [],
          conAudio: false,
          correccionColorAplicada: false,
          fuente: { archivoOriginal: "/x/original.mp4", inicioSeg: 0, finSeg: 5 },
        },
      ],
    });
    const result = await applyEscenaTreatments(
      ["/x/ADS-01-ESCENA-04.MP4"],
      [{ numero: 4, texto: "algo", requisitos: [{ tipo: "algo-inventado", referencia: "sunat" }] }],
      { bRollLibraryPath: libraryPath, workDir },
    );
    expect(result).toEqual(["/x/ADS-01-ESCENA-04.MP4"]);
  });
});
