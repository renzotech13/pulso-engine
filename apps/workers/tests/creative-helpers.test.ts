import { describe, expect, it } from "vitest";
import {
  buildBriefForComponentRef,
  creativeTypeForTemplateType,
  pickProductPhoto,
  templateNameForSlotType,
  findBannedPhrase,
  findEmDash,
  BANK_STRONG_MATCH,
  BANK_WEAK_MATCH,
  decidePhotoSource,
  rankBankPhotos,
  tokenize,
  type BankPhotoLookup,
} from "../src/agents/creative-helpers.js";

describe("templateNameForSlotType", () => {
  it("maps known slot types to their render template name", () => {
    expect(templateNameForSlotType("post")).toBe("social-post");
    expect(templateNameForSlotType("reel")).toBe("reel");
    expect(templateNameForSlotType("story")).toBe("story-promo");
    expect(templateNameForSlotType("carousel")).toBe("carousel");
  });

  it("returns null for slot types without a template yet", () => {
    expect(templateNameForSlotType("unknown-slot-type")).toBeNull();
  });
});

describe("creativeTypeForTemplateType", () => {
  it("maps static to image and video to video", () => {
    expect(creativeTypeForTemplateType("static")).toBe("image");
    expect(creativeTypeForTemplateType("video")).toBe("video");
  });
});

describe("buildBriefForComponentRef", () => {
  it("passes headline/subheadline/priceLabel through unchanged for social-post", () => {
    const brief = buildBriefForComponentRef("social-post", {
      headline: "20% en masajes",
      subheadline: "Por Fiestas Patrias",
      priceLabel: "Desde S/ 96",
    });
    expect(brief).toEqual({
      headline: "20% en masajes",
      subheadline: "Por Fiestas Patrias",
      priceLabel: "Desde S/ 96",
    });
  });

  it("omits absent optional fields instead of writing them as undefined", () => {
    const brief = buildBriefForComponentRef("reel", { headline: "20% en masajes" });
    expect(brief).toEqual({ headline: "20% en masajes" });
  });

  it("collapses headline+subheadline into a single message for story-promo", () => {
    const brief = buildBriefForComponentRef("story-promo", {
      headline: "20% en masajes",
      subheadline: "Por Fiestas Patrias",
    });
    expect(brief).toEqual({ message: "20% en masajes. Por Fiestas Patrias" });
  });

  it("uses just the headline as the message when there's no subheadline", () => {
    const brief = buildBriefForComponentRef("story-promo", { headline: "20% en masajes" });
    expect(brief).toEqual({ message: "20% en masajes" });
  });

  it("includes photoUrl when provided, for both social-post and story-promo", () => {
    expect(
      buildBriefForComponentRef("social-post", { headline: "20% en masajes" }, "https://x/photo.jpg"),
    ).toEqual({ headline: "20% en masajes", photoUrl: "https://x/photo.jpg" });

    expect(
      buildBriefForComponentRef("story-promo", { headline: "20% en masajes" }, "https://x/photo.jpg"),
    ).toEqual({ message: "20% en masajes", photoUrl: "https://x/photo.jpg" });
  });

  it("omits photoUrl entirely when none was resolved", () => {
    const brief = buildBriefForComponentRef("social-post", { headline: "20% en masajes" }, undefined);
    expect(brief).toEqual({ headline: "20% en masajes" });
  });

  it("passes the slides array through unchanged for carousel", () => {
    const slides = ["¿Sabías esto?", "Tip 1", "Tip 2", "Tip 3", "Cuéntanos en los comentarios 👇"];
    const brief = buildBriefForComponentRef("carousel", { slides });
    expect(brief).toEqual({ slides });
  });

  it("defaults to an empty slides array when none was generated", () => {
    const brief = buildBriefForComponentRef("carousel", {});
    expect(brief).toEqual({ slides: [] });
  });

  it("includes photoUrls and color override for carousel when provided", () => {
    const slides = ["a", "b", "c", "d", "e"];
    const photoUrls = ["https://x/0.jpg", undefined, "https://x/2.jpg", undefined, undefined];
    const brief = buildBriefForComponentRef(
      "carousel",
      { slides },
      undefined,
      { colorPrimary: "#D91023", colorSecondary: "#FFFFFF" },
      photoUrls,
    );
    expect(brief).toEqual({
      slides,
      photoUrls,
      colorPrimary: "#D91023",
      colorSecondary: "#FFFFFF",
    });
  });

  it("omits photoUrls entirely when every slide came back with none", () => {
    const slides = ["a", "b", "c", "d", "e"];
    const brief = buildBriefForComponentRef("carousel", { slides }, undefined, undefined, [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(brief).toEqual({ slides });
  });

  it("includes videoEffects on the brief for reel when the LLM returned some", () => {
    const brief = buildBriefForComponentRef("reel", {
      headline: "20% en masajes",
      videoEffects: { hideLogo: true, zoomOutBackground: true },
    });
    expect(brief).toEqual({
      headline: "20% en masajes",
      videoEffects: { hideLogo: true, zoomOutBackground: true },
    });
  });

  it("omits videoEffects entirely for reel when the LLM didn't return any", () => {
    const brief = buildBriefForComponentRef("reel", { headline: "20% en masajes" });
    expect(brief).toEqual({ headline: "20% en masajes" });
  });

  it("never puts videoEffects on a social-post brief even if present in copy", () => {
    const brief = buildBriefForComponentRef("social-post", {
      headline: "20% en masajes",
      videoEffects: { hideLogo: true },
    });
    expect(brief).toEqual({ headline: "20% en masajes" });
  });

  it("includes the real post caption for carousel when the LLM wrote one", () => {
    const slides = ["a", "b", "c", "d", "e"];
    const caption = "Un texto real para la publicación, con fuente y hashtags. #tips";
    const brief = buildBriefForComponentRef("carousel", { slides, caption });
    expect(brief).toEqual({ slides, caption });
  });

  it("omits caption entirely when the LLM didn't write one", () => {
    const slides = ["a", "b", "c", "d", "e"];
    const brief = buildBriefForComponentRef("carousel", { slides });
    expect(brief).toEqual({ slides });
  });
});

describe("pickProductPhoto", () => {
  const products = [
    { name: "Masaje relajante", photo_urls: ["https://x/masaje.jpg"] },
    { name: "Facial hidratante", photo_urls: [] },
  ];

  it("matches a product by exact name (case-insensitive) and returns its first photo", () => {
    expect(pickProductPhoto(products, "masaje relajante")).toBe("https://x/masaje.jpg");
    expect(pickProductPhoto(products, "Masaje Relajante")).toBe("https://x/masaje.jpg");
  });

  it("returns undefined when the matched product has no photos", () => {
    expect(pickProductPhoto(products, "Facial hidratante")).toBeUndefined();
  });

  it("returns undefined when no product matches", () => {
    expect(pickProductPhoto(products, "Producto inexistente")).toBeUndefined();
  });

  it("returns undefined when no productName was given", () => {
    expect(pickProductPhoto(products, undefined)).toBeUndefined();
  });
});

describe("findBannedPhrase", () => {
  const banned = ["sin sustos", "sinergia"];

  it("returns null when nothing is banned", () => {
    expect(findBannedPhrase({ caption: "sin sustos" }, [])).toBeNull();
  });

  it("finds a banned phrase in a string field and names the field", () => {
    expect(findBannedPhrase({ headline: "Hola", caption: "tu salto limpio y sin sustos" }, banned)).toEqual({
      phrase: "sin sustos",
      field: "caption",
    });
  });

  it("ignores case and diacritics on both sides", () => {
    expect(findBannedPhrase({ headline: "SIN SÚSTOS" }, banned)?.phrase).toBe("sin sustos");
    expect(findBannedPhrase({ headline: "sinergia total" }, ["SINERGÍA"])?.phrase).toBe("SINERGÍA");
  });

  it("scans every string inside an array field (carousel slides)", () => {
    expect(findBannedPhrase({ slides: ["uno", "dos", "buscamos sinergias"] }, banned)).toEqual({
      phrase: "sinergia",
      field: "slides",
    });
  });

  it("skips undefined, null and non-string values without throwing", () => {
    expect(findBannedPhrase({ subheadline: undefined, priceLabel: null, videoEffects: { hideLogo: true } }, banned)).toBeNull();
  });

  it("matches across a line break, a non-breaking space and doubled spaces", () => {
    for (const caption of ["sin\nsustos", "sin\u00a0sustos", "sin  sustos", "SIN\n\nSustos ni multas"]) {
      expect(findBannedPhrase({ caption }, banned)?.phrase).toBe("sin sustos");
    }
  });

  it("treats whitespace-only banned entries as absent", () => {
    expect(findBannedPhrase({ caption: "anything" }, ["  ", ""])).toBeNull();
  });
});

describe("tokenize", () => {
  it("lowercases, strips diacritics and stopwords, drops numbers, stems to 6 chars, dedupes", () => {
    expect(tokenize("La diferencia entre RUC 10 y RUC 20: formalización y Formalizar")).toEqual([
      "difere",
      "ruc",
      "formal",
    ]);
  });

  it("treats singular and plural as one word", () => {
    for (const [singular, plural] of [
      ["venta", "ventas"],
      ["cliente", "clientes"],
      ["impuesto", "impuestos"],
      ["documento", "documentos"],
    ]) {
      expect(tokenize(singular!)).toEqual(tokenize(plural!));
    }
  });

  it("keeps words that only collided because five letters was too few", () => {
    // "de forma" must not stem to "formalización", nor "contamos" to "contabilidad".
    expect(tokenize("forma")).not.toEqual(tokenize("formalizacion"));
    expect(tokenize("contamos")).not.toEqual(tokenize("contabilidad"));
  });
});

describe("rankBankPhotos", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  const photo = (id: string, tags: string[], extra: Partial<BankPhotoLookup> = {}): BankPhotoLookup => ({
    id,
    url: `https://x/brand-assets/t/library-00000000-0000-0000-0000-000000000000-${id}.jpg`,
    tags,
    description: null,
    has_people: true,
    orientation: "landscape",
    last_used_at: null,
    ...extra,
  });
  const sunat = photo("sunat-doc", ["emprendedora", "documento", "sunat", "formalizacion", "oficina"]);
  const bulb = photo("bulb-idea", ["foco", "idea", "brainstorming", "oficina"]);

  it("ranks the SUNAT/formalización photo above the lightbulb one for a RUC theme, via synonyms", () => {
    const ranked = rankBankPhotos([bulb, sunat], { texts: ["La diferencia entre RUC 10 y RUC 20"], now });
    expect(ranked[0]?.asset.id).toBe("sunat-doc");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    // "~" marks a loose (synonym) hit: this photo has no "ruc" tag, it is
    // reached through ruc→sunat and therefore scores at half weight.
    expect(ranked[0]!.matched).toContain("~ruc→sunat");
  });

  it("penalizes a photo used in the last three days and honours excludeIds", () => {
    const recent = photo("recent", ["sunat", "formalizacion"], { last_used_at: "2026-09-04T12:00:00Z" });
    const fresh = photo("fresh", ["sunat", "formalizacion"]);
    const ranked = rankBankPhotos([recent, fresh], { texts: ["sunat formalización"], now });
    expect(ranked[0]?.asset.id).toBe("fresh");
    expect(rankBankPhotos([recent, fresh], { texts: ["sunat"], now, excludeIds: ["fresh"] }).map((r) => r.asset.id)).toEqual(["recent"]);
  });

  it("prefers portrait photos for vertical formats and lands in the thresholds' range", () => {
    const portrait = photo("p", ["sunat"], { orientation: "portrait" });
    const landscape = photo("l", ["sunat"], { orientation: "landscape" });
    const ranked = rankBankPhotos([landscape, portrait], { texts: ["sunat"], now, preferPortrait: true });
    expect(ranked[0]?.asset.id).toBe("p");
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(BANK_STRONG_MATCH);
    expect(rankBankPhotos([bulb], { texts: ["sunat"], now })[0]!.score).toBeLessThan(BANK_WEAK_MATCH);
  });

  it("matches words from the stock filename when a photo has no tags yet", () => {
    const untagged = photo("businesswoman-thinking-office", []);
    expect(rankBankPhotos([untagged], { texts: ["oficina businesswoman"], now })[0]!.matched).toContain("busine");
  });

  it("breaks ties deterministically: never used first, then by id", () => {
    const a = photo("b-id", ["sunat"]);
    const b = photo("a-id", ["sunat"]);
    const used = photo("c-id", ["sunat"], { last_used_at: "2026-01-01T00:00:00Z" });
    expect(rankBankPhotos([used, a, b], { texts: ["nothing-matches"], now }).map((r) => r.asset.id)).toEqual(["a-id", "b-id", "c-id"]);
  });
});

describe("decidePhotoSource", () => {
  const base = { geminiAvailable: true, recentSources: [] as const, geminiShare: 40 };

  it("empty bank → gemini, or gradient without Gemini", () => {
    expect(decidePhotoSource({ ...base, bestBankScore: null })).toBe("gemini");
    expect(decidePhotoSource({ ...base, bestBankScore: null, geminiAvailable: false })).toBe("gradient");
  });

  it("legacy tenants (no share) and share 0 always take the bank", () => {
    expect(decidePhotoSource({ ...base, bestBankScore: 0, geminiShare: null })).toBe("bank");
    expect(decidePhotoSource({ ...base, bestBankScore: 0, geminiShare: 0 })).toBe("bank");
  });

  it("a strong match takes the bank unless the last three were already bank", () => {
    expect(decidePhotoSource({ ...base, bestBankScore: 0.5 })).toBe("bank");
    expect(decidePhotoSource({ ...base, bestBankScore: 0.5, recentSources: ["bank", "bank", "bank"] })).toBe("gemini");
  });

  it("a weak match goes to Gemini rather than an unrelated photo", () => {
    expect(decidePhotoSource({ ...base, bestBankScore: 0.05 })).toBe("gemini");
  });

  it("in between, streaks alternate and the share settles the rest", () => {
    expect(decidePhotoSource({ ...base, bestBankScore: 0.2, recentSources: ["gemini", "gemini"] })).toBe("bank");
    expect(decidePhotoSource({ ...base, bestBankScore: 0.2, recentSources: ["bank", "bank", "bank"] })).toBe("gemini");
    // 1 of 5 recent were Gemini = 20% < 40% target → gemini
    expect(decidePhotoSource({ ...base, bestBankScore: 0.2, recentSources: ["bank", "gemini", "bank", "bank", "bank"] })).toBe("gemini");
    // 2 of 4 = 50% ≥ 40% → bank
    expect(decidePhotoSource({ ...base, bestBankScore: 0.2, recentSources: ["gemini", "bank", "gemini", "bank"] })).toBe("bank");
  });
});

describe("rankBankPhotos — defects an adversarial review reproduced", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  const photo = (id: string, tags: string[], last: string | null = null): BankPhotoLookup => ({
    id,
    url: `https://x/brand-assets/t/library-00000000-0000-0000-0000-000000000000-${id}.jpg`,
    tags,
    description: null,
    has_people: true,
    orientation: "landscape",
    last_used_at: last,
  });
  const sunat = photo("sunat", ["emprendedora", "documento", "sunat", "formalizacion", "oficina", "ruc", "impuestos"]);
  const theme = "La diferencia entre RUC 10 y RUC 20";

  it("does not let headline, subheadline and LLM keywords dilute the score below the thresholds", () => {
    const themeOnly = rankBankPhotos([sunat], { texts: [theme], now })[0]!.score;
    const withCopy = rankBankPhotos([sunat], {
      texts: [theme],
      hints: [
        "¿RUC 10 o RUC 20? Elige bien desde el inicio",
        "Te explicamos cuál conviene para tu negocio y evita multas",
        "professional",
        "modern",
        "clean",
        "bright",
        "minimal",
        "corporate",
      ],
      now,
    })[0]!.score;
    expect(withCopy).toBeGreaterThanOrEqual(themeOnly);
    expect(withCopy).toBeGreaterThanOrEqual(BANK_STRONG_MATCH);
    expect(withCopy).toBeLessThanOrEqual(1);
  });

  it("ranks a direct tag hit above a synonym hit instead of tying on last_used_at", () => {
    // The corner-shop photo is reachable only through ruc→negocio, and it has
    // waited longer — under equal weights it won the tiebreak and went out.
    const bodega = photo("bodega", ["tienda", "bodega", "cliente", "venta", "negocio"], "2026-01-01T00:00:00Z");
    const ranked = rankBankPhotos([bodega, sunat], { texts: [theme], now });
    expect(ranked[0]?.asset.id).toBe("sunat");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("does not fire the formalización or contabilidad synonyms on 'de forma' / 'Te contamos'", () => {
    const tienda = photo("tienda", ["tienda", "orden", "estante"]);
    const shop = rankBankPhotos([sunat, tienda], { texts: ["Cómo organizar tu tienda de forma eficiente"], now });
    expect(shop[0]?.asset.id).toBe("tienda");
    expect(shop.find((r) => r.asset.id === "sunat")!.score).toBe(0);

    const bulb = photo("bulb", ["foco", "idea", "brainstorming", "oficina"]);
    const cliente = photo("cliente", ["cliente", "atencion", "mostrador"]);
    const service = rankBankPhotos([bulb, cliente], { texts: ["Te contamos cómo atender mejor a tus clientes"], now });
    expect(service[0]?.asset.id).toBe("cliente");
    expect(service.find((r) => r.asset.id === "bulb")!.score).toBe(0);
  });
});

describe("decidePhotoSource — Gemini unavailable", () => {
  const recentSources = [] as const;

  it("falls back to the gradient rather than an unrelated photo when the budget is spent", () => {
    expect(decidePhotoSource({ bestBankScore: 0, geminiAvailable: false, recentSources, geminiShare: 40 })).toBe("gradient");
    expect(decidePhotoSource({ bestBankScore: 0.3, geminiAvailable: false, recentSources, geminiShare: 40 })).toBe("bank");
  });

  it("still gives a legacy tenant (no share configured) its plain rotation", () => {
    expect(decidePhotoSource({ bestBankScore: 0, geminiAvailable: false, recentSources, geminiShare: null })).toBe("bank");
  });
});

describe("findEmDash", () => {
  it("finds an em dash in a string field and names the field", () => {
    expect(findEmDash({ headline: "Sin raya", caption: "Antes — después" })).toEqual({ field: "caption" });
  });

  it("finds it inside an array field (carousel slides)", () => {
    expect(findEmDash({ slides: ["uno", "dos — tres"] })).toEqual({ field: "slides" });
  });

  it("returns null when there is none, and ignores a plain hyphen", () => {
    expect(findEmDash({ headline: "co-fundador, 24-7, punto-com" })).toBeNull();
  });
});

describe("buildBriefForComponentRef — story-promo message", () => {
  it("joins headline and subheadline without an em dash", () => {
    const brief = buildBriefForComponentRef("story-promo", {
      headline: "¿Tu contabilidad te da dolores de cabeza?",
      subheadline: "Deja de adivinar si estás al día con SUNAT.",
    });
    expect(brief.message).toBe(
      "¿Tu contabilidad te da dolores de cabeza? Deja de adivinar si estás al día con SUNAT.",
    );
  });

  it("adds a period when the headline has no closing punctuation of its own", () => {
    const brief = buildBriefForComponentRef("story-promo", {
      headline: "Tu contabilidad al día",
      subheadline: "sin sorpresas",
    });
    expect(brief.message).toBe("Tu contabilidad al día. sin sorpresas");
  });
});
