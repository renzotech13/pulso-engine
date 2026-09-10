import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadDefaultPreset,
  loadPreset,
  PresetError,
  resolveOutputSpec,
  resolveSubtitleAnimation,
  resolveTitleAnimation,
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
  });

  it("falls back to 'ninguna' for an unsupported value instead of throwing", () => {
    expect(resolveSubtitleAnimation("slide-in-from-mars")).toBe("ninguna");
    expect(resolveTitleAnimation("slide-in-from-mars")).toBe("ninguna");
  });
});
