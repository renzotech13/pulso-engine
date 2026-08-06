import { describe, expect, it } from "vitest";
import { buildCaption } from "../src/publish-helpers.js";

describe("buildCaption", () => {
  it("joins headline/subheadline/priceLabel with blank lines", () => {
    const caption = buildCaption({
      headline: "20% en masajes",
      subheadline: "Por Fiestas Patrias",
      priceLabel: "Desde S/ 96",
    });
    expect(caption).toBe("20% en masajes\n\nPor Fiestas Patrias\n\nDesde S/ 96");
  });

  it("omits absent fields instead of leaving blank lines", () => {
    const caption = buildCaption({ headline: "20% en masajes" });
    expect(caption).toBe("20% en masajes");
  });

  it("uses message for story-promo style briefs", () => {
    const caption = buildCaption({ message: "20% en masajes por Fiestas Patrias" });
    expect(caption).toBe("20% en masajes por Fiestas Patrias");
  });

  it("appends priceLabel after message when both are present", () => {
    const caption = buildCaption({ message: "20% en masajes", priceLabel: "Desde S/ 96" });
    expect(caption).toBe("20% en masajes\n\nDesde S/ 96");
  });

  it("returns an empty string when the brief has no recognized fields", () => {
    expect(buildCaption({})).toBe("");
  });

  it("uses caption as-is for photo-frame briefs", () => {
    const caption = buildCaption({ caption: "Sub-13 vs Academia Los Leones", photoUrls: ["https://x/a.jpg"] });
    expect(caption).toBe("Sub-13 vs Academia Los Leones");
  });
});
