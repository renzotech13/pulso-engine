import { describe, expect, it } from "vitest";
import {
  dedupeHeadlines,
  formatHeadlinesForPrompt,
  mapRelevantPicks,
  type NewsHeadline,
} from "../src/agents/news-helpers.js";

const headline = (overrides: Partial<NewsHeadline> = {}): NewsHeadline => ({
  title: "Título de ejemplo",
  link: "https://example.com/noticia",
  source: "Gestión",
  summary: "Un resumen breve",
  publishedAt: null,
  ...overrides,
});

describe("formatHeadlinesForPrompt", () => {
  it("returns a placeholder for an empty list", () => {
    expect(formatHeadlinesForPrompt([])).toBe("(sin titulares hoy)");
  });

  it("numbers headlines 1-based with source and summary", () => {
    const result = formatHeadlinesForPrompt([
      headline({ title: "Primero", source: "Gestión", summary: "resumen 1" }),
      headline({ title: "Segundo", source: "El Comercio", summary: "" }),
    ]);
    expect(result).toBe("1. [Gestión] Primero — resumen 1\n2. [El Comercio] Segundo");
  });
});

describe("mapRelevantPicks", () => {
  it("resolves 1-based indices back to the matching headline", () => {
    const headlines = [
      headline({ title: "Primero", link: "https://example.com/1" }),
      headline({ title: "Segundo", link: "https://example.com/2" }),
    ];
    const drafts = mapRelevantPicks(headlines, [{ index: 2, angle: "Ángulo para el segundo" }]);
    expect(drafts).toEqual([
      {
        headline: "Segundo",
        sourceUrl: "https://example.com/2",
        sourceName: "Gestión",
        summary: "Un resumen breve",
        angle: "Ángulo para el segundo",
        publishedAt: null,
      },
    ]);
  });

  it("silently drops an out-of-range index instead of throwing", () => {
    const headlines = [headline()];
    const drafts = mapRelevantPicks(headlines, [
      { index: 1, angle: "válido" },
      { index: 99, angle: "inventado" },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.angle).toBe("válido");
  });

  it("returns an empty list when the LLM found nothing relevant", () => {
    expect(mapRelevantPicks([headline()], [])).toEqual([]);
  });
});

describe("dedupeHeadlines", () => {
  it("keeps the first occurrence and drops later ones with the same link", () => {
    const headlines = [
      headline({ title: "Primera versión", link: "https://example.com/dup" }),
      headline({ title: "Segunda versión (otra fuente)", link: "https://example.com/dup" }),
      headline({ title: "Distinta", link: "https://example.com/otra" }),
    ];
    const result = dedupeHeadlines(headlines);
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("Primera versión");
    expect(result[1]?.title).toBe("Distinta");
  });
});
