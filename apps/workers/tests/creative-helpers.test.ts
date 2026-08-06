import { describe, expect, it } from "vitest";
import {
  buildBriefForComponentRef,
  creativeTypeForTemplateType,
  pickProductPhoto,
  templateNameForSlotType,
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
    expect(brief).toEqual({ message: "20% en masajes — Por Fiestas Patrias" });
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
