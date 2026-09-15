import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveVideoPathsForScript } from "../src/pipeline/project.js";

async function touch(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "");
}

describe("resolveVideoPathsForScript", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "pulso-video-editor-carpeta-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("lists every mp4 inside a real subdirectory named after carpetaTomas", async () => {
    await touch(path.join(base, "ADS-01", "ADS-01-ESCENA-01.MP4"));
    await touch(path.join(base, "ADS-01", "ADS-01-ESCENA-04.MP4"));
    await touch(path.join(base, "ADS-02", "ADS-02-ESCENA-01.MP4"));

    const resolved = await resolveVideoPathsForScript("ADS-01", base);
    expect(resolved.map((p) => path.basename(p)).sort()).toEqual(["ADS-01-ESCENA-01.MP4", "ADS-01-ESCENA-04.MP4"]);
  });

  it("finds the subfolder when its name only differs in separators or case — real AZ layout 'ELEGIDAS/ADS 01'", async () => {
    await touch(path.join(base, "ADS 01", "ADS-01-ESCENA-03-PARTE-02.MP4"));
    await touch(path.join(base, "ADS-02-ESCENA-01.MP4"));

    const resolved = await resolveVideoPathsForScript("ADS-01", base);
    expect(resolved.map((p) => path.basename(p))).toEqual(["ADS-01-ESCENA-03-PARTE-02.MP4"]);
  });

  it("falls back to matching filenames by substring in a flat folder, including a retake prefixed with something else", async () => {
    await touch(path.join(base, "ADS-04-ESCENA-01.MP4"));
    await touch(path.join(base, "ADS-04-ESCENA-02-PARTE-01.MP4"));
    await touch(path.join(base, "BLOQUE-02-ADS-04-ESCENA-02.MP4"));
    await touch(path.join(base, "ADS-05-ESCENA-01.MP4"));

    const resolved = await resolveVideoPathsForScript("ADS-04", base);
    expect(resolved.map((p) => path.basename(p)).sort()).toEqual([
      "ADS-04-ESCENA-01.MP4",
      "ADS-04-ESCENA-02-PARTE-01.MP4",
      "BLOQUE-02-ADS-04-ESCENA-02.MP4",
    ]);
  });

  it("does not let a shorter carpetaTomas match a longer numeric prefix (ADS-4 vs ADS-40)", async () => {
    await touch(path.join(base, "ADS-40-ESCENA-01.MP4"));

    await expect(resolveVideoPathsForScript("ADS-4", base)).rejects.toThrow(/no se encontró ninguna toma/);
  });

  it("throws a clear error when nothing matches, instead of silently returning an empty video list", async () => {
    await touch(path.join(base, "ADS-99-ESCENA-01.MP4"));
    await expect(resolveVideoPathsForScript("ADS-01", base)).rejects.toThrow(/no se encontró ninguna toma/);
  });
});
