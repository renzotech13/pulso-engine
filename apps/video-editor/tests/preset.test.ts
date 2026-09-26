import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadDefaultPreset,
  loadPreset,
  presetSchema,
  PresetError,
  resolveNivelEfecto,
  resolveOutputSpec,
  resolveSubtitleAnimation,
  resolveTitleAnimation,
  splitTresNivelesTexto,
} from "../src/pipeline/preset.js";

describe("loadDefaultPreset", () => {
  it("loads and validates the shipped default preset", async () => {
    const preset = await loadDefaultPreset();
    expect(preset.id).toBe("pulso-principal");
    expect(preset.subtitulos.palabrasPorBloque).toBeGreaterThan(0);
    expect(preset.salida.formato).toBe("9:16");
  });
});

describe("loadPreset", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pulso-preset-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects a preset with an invalid color", async () => {
    const defaultRaw = await readFile(
      path.join(import.meta.dirname, "..", "config", "presets", "default.json"),
      "utf8",
    );
    const broken = JSON.parse(defaultRaw);
    broken.subtitulos.color = "not-a-color";
    const filePath = path.join(dir, "broken.json");
    await writeFile(filePath, JSON.stringify(broken));

    await expect(loadPreset(filePath)).rejects.toThrow(PresetError);
  });

  it("rejects malformed JSON with a clear error", async () => {
    const filePath = path.join(dir, "invalid.json");
    await writeFile(filePath, "{ not json");
    await expect(loadPreset(filePath)).rejects.toThrow(/JSON válido/);
  });

  it("rejects a missing file with a clear error", async () => {
    await expect(loadPreset(path.join(dir, "does-not-exist.json"))).rejects.toThrow(/no se pudo leer/);
  });
});

describe("resolveOutputSpec", () => {
  it("uses the preset's own resolution/fps for a fixed format", async () => {
    const preset = await loadDefaultPreset();
    const spec = resolveOutputSpec(preset, { width: 3840, height: 2160, fps: 60 });
    expect(spec).toEqual({ width: 1080, height: 1920, fps: 30, crf: 18 });
  });

  it("uses the source footage's own geometry for conservar-origen", async () => {
    const preset = await loadDefaultPreset();
    preset.salida = { ...preset.salida, formato: "conservar-origen" };
    const spec = resolveOutputSpec(preset, { width: 1920, height: 1080, fps: 24 });
    expect(spec).toEqual({ width: 1920, height: 1080, fps: 24, crf: preset.salida.crf });
  });
});

describe("resolveSubtitleAnimation / resolveTitleAnimation", () => {
  it("passes through a supported value", () => {
    expect(resolveSubtitleAnimation("pop")).toBe("pop");
    expect(resolveTitleAnimation("fadeIn")).toBe("fadeIn");
    expect(resolveTitleAnimation("wipeVertical")).toBe("wipeVertical");
  });

  it("falls back to 'ninguna' for an unsupported value instead of throwing", () => {
    expect(resolveSubtitleAnimation("slide-in-from-mars")).toBe("ninguna");
    expect(resolveTitleAnimation("slide-in-from-mars")).toBe("ninguna");
  });
});

describe("splitTresNivelesTexto", () => {
  it("splits the 3 pipe-delimited lines and trims each one", () => {
    expect(splitTresNivelesTexto("Blanco Rosa | ROSA | PALO")).toEqual(["Blanco Rosa", "ROSA", "PALO"]);
  });

  it("fills missing parts with an empty string instead of throwing", () => {
    expect(splitTresNivelesTexto("Solo superior")).toEqual(["Solo superior", "", ""]);
    expect(splitTresNivelesTexto("")).toEqual(["", "", ""]);
  });

  it("ignores any part beyond the 3rd", () => {
    expect(splitTresNivelesTexto("Uno | Dos | Tres | Cuatro")).toEqual(["Uno", "Dos", "Tres"]);
  });
});

describe("tituloSchema — estilo tresNiveles", () => {
  const nivel = { fuente: { familia: "Inter" }, tamano: 40, color: "#FFFFFF" };

  it("accepts a 'tresNiveles' título with its 3 levels configured", async () => {
    const preset = await loadDefaultPreset();
    const withTresNiveles = {
      ...preset,
      titulo: {
        ...preset.titulo,
        estilo: "tresNiveles",
        tresNiveles: { superior: nivel, medio: nivel, inferior: nivel },
      },
    };
    const result = presetSchema.safeParse(withTresNiveles);
    expect(result.success).toBe(true);
  });

  it("rejects estilo 'tresNiveles' without the per-level config — never silently falls back to 'simple'", async () => {
    const preset = await loadDefaultPreset();
    const missingConfig = { ...preset, titulo: { ...preset.titulo, estilo: "tresNiveles" } };
    const result = presetSchema.safeParse(missingConfig);
    expect(result.success).toBe(false);
  });
});

describe("resolveNivelEfecto", () => {
  it("passes through a supported value", () => {
    expect(resolveNivelEfecto("mascaraVertical")).toBe("mascaraVertical");
    expect(resolveNivelEfecto("letrasOla")).toBe("letrasOla");
    expect(resolveNivelEfecto("letrasJuntan")).toBe("letrasJuntan");
  });

  it("falls back to 'ninguna' for an unsupported value instead of throwing", () => {
    expect(resolveNivelEfecto("efecto-inventado")).toBe("ninguna");
  });
});
