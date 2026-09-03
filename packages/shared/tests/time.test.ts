import { describe, expect, it } from "vitest";
import { limaHour, limaToday } from "../src/time.js";

describe("limaToday", () => {
  it("returns Lima's day, not UTC's", () => {
    // 2026-09-04T02:30:00Z is 21:30 on September 3rd in Lima. This is exactly
    // the case that broke publish.tick: for UTC it was already the 4th, so
    // the 4th's slots counted as publishable five hours early.
    expect(limaToday(new Date("2026-09-04T02:30:00Z"))).toBe("2026-09-03");
  });

  it("agrees with UTC during the Peruvian day", () => {
    expect(limaToday(new Date("2026-09-03T15:00:00Z"))).toBe("2026-09-03");
  });
});

describe("limaHour", () => {
  it("converts UTC to Lima's hour", () => {
    expect(limaHour(new Date("2026-09-03T14:00:00Z"))).toBe(9);
    expect(limaHour(new Date("2026-09-03T23:00:00Z"))).toBe(18);
  });

  it("reports midnight in Lima as 0, never 24", () => {
    expect(limaHour(new Date("2026-09-03T05:00:00Z"))).toBe(0);
  });
});
