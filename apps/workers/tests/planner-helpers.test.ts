import { describe, expect, it } from "vitest";
import {
  applyReelsPause,
  applyWeeklyCarouselCap,
  computeOpenDates,
  resolveEphemeridesInWindow,
  weekStartDate,
  type EphemerisLike,
} from "../src/agents/planner-helpers.js";

describe("computeOpenDates", () => {
  it("returns every date in the horizon when nothing is filled", () => {
    const today = new Date("2026-07-17T00:00:00Z");
    const open = computeOpenDates(today, 5, new Set());
    expect(open).toEqual([
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
    ]);
  });

  it("excludes dates that already have a slot", () => {
    const today = new Date("2026-07-17T00:00:00Z");
    const open = computeOpenDates(today, 5, new Set(["2026-07-18", "2026-07-20"]));
    expect(open).toEqual(["2026-07-17", "2026-07-19", "2026-07-21"]);
  });

  it("is not thrown off by a `today` with a non-midnight time component", () => {
    const today = new Date("2026-07-17T23:45:00Z");
    const open = computeOpenDates(today, 2, new Set());
    expect(open).toEqual(["2026-07-17", "2026-07-18"]);
  });
});

describe("resolveEphemeridesInWindow", () => {
  const today = new Date("2026-07-17T00:00:00Z");

  it("resolves a recurring ephemeris that falls within the window this year", () => {
    const ephemerides: EphemerisLike[] = [
      { name: "Fiestas Patrias", date: "2026-07-28", is_recurring_annually: true, relevance_tags: ["general"] },
    ];
    const resolved = resolveEphemeridesInWindow(ephemerides, today, 30, "spa");
    expect(resolved).toEqual([{ name: "Fiestas Patrias", date: "2026-07-28" }]);
  });

  it("excludes a recurring ephemeris outside the window", () => {
    const ephemerides: EphemerisLike[] = [
      { name: "Navidad", date: "2026-12-25", is_recurring_annually: true, relevance_tags: ["general"] },
    ];
    expect(resolveEphemeridesInWindow(ephemerides, today, 30, "spa")).toEqual([]);
  });

  it("rolls a recurring ephemeris over to next year when this year's occurrence already passed", () => {
    // "today" is set right after New Year's Day, so the window must pick up
    // next year's occurrence, not this year's already-past one.
    const lateToday = new Date("2026-01-05T00:00:00Z");
    const ephemerides: EphemerisLike[] = [
      { name: "Año Nuevo", date: "2026-01-01", is_recurring_annually: true, relevance_tags: ["general"] },
    ];
    // Window doesn't reach next Jan 1st within 30 days, so nothing resolves —
    // this just confirms it doesn't wrongly resolve to the already-past date.
    expect(resolveEphemeridesInWindow(ephemerides, lateToday, 30, "spa")).toEqual([]);
  });

  it("resolves a non-recurring (pre-resolved floating date) ephemeris as-is", () => {
    const withinWindow = new Date("2027-05-01T00:00:00Z");
    const ephemerides: EphemerisLike[] = [
      { name: "Día de la Madre", date: "2027-05-09", is_recurring_annually: false, relevance_tags: ["general"] },
    ];
    expect(resolveEphemeridesInWindow(ephemerides, withinWindow, 30, "spa")).toEqual([
      { name: "Día de la Madre", date: "2027-05-09" },
    ]);
  });

  it("includes rubro-specific ephemerides only for the matching rubro", () => {
    const ephemerides: EphemerisLike[] = [
      { name: "Día del Café Peruano", date: "2026-07-20", is_recurring_annually: true, relevance_tags: ["restaurante"] },
    ];
    expect(resolveEphemeridesInWindow(ephemerides, today, 30, "restaurante")).toHaveLength(1);
    expect(resolveEphemeridesInWindow(ephemerides, today, 30, "spa")).toEqual([]);
    expect(resolveEphemeridesInWindow(ephemerides, today, 30, null)).toEqual([]);
  });

  it("always includes 'general' ephemerides regardless of rubro", () => {
    const ephemerides: EphemerisLike[] = [
      { name: "Fiestas Patrias", date: "2026-07-28", is_recurring_annually: true, relevance_tags: ["general"] },
    ];
    expect(resolveEphemeridesInWindow(ephemerides, today, 30, "ecommerce")).toHaveLength(1);
    expect(resolveEphemeridesInWindow(ephemerides, today, 30, null)).toHaveLength(1);
  });
});

describe("weekStartDate", () => {
  it("returns the Monday of a mid-week date", () => {
    expect(weekStartDate("2026-09-03")).toBe("2026-08-31"); // Thursday -> Monday
  });

  it("is idempotent on a Monday", () => {
    expect(weekStartDate("2026-08-31")).toBe("2026-08-31");
  });

  it("rolls Sunday back to the same week's Monday, not the next one", () => {
    expect(weekStartDate("2026-09-06")).toBe("2026-08-31");
  });
});

describe("applyWeeklyCarouselCap", () => {
  const post = (date: string) => ({ date, slot_type: "post" });
  const carousel = (date: string) => ({ date, slot_type: "carousel" });

  it("passes every slot through unchanged when uncapped", () => {
    const proposed = [carousel("2026-09-01"), carousel("2026-09-02")];
    expect(applyWeeklyCarouselCap(proposed, [], undefined)).toEqual(proposed);
  });

  it("keeps the first carousel of the week and downgrades the rest to post", () => {
    const proposed = [post("2026-08-31"), carousel("2026-09-01"), carousel("2026-09-03")];
    const result = applyWeeklyCarouselCap(proposed, [], 1);
    expect(result.map((s) => s.slot_type)).toEqual(["post", "carousel", "post"]);
  });

  it("counts a carousel already scheduled by a previous run against the same week's cap", () => {
    const proposed = [carousel("2026-09-02")];
    const alreadyScheduled = [carousel("2026-08-31")];
    const result = applyWeeklyCarouselCap(proposed, alreadyScheduled, 1);
    expect(result[0]!.slot_type).toBe("post");
  });

  it("does not let one week's cap affect the next week's budget", () => {
    const proposed = [carousel("2026-08-31"), carousel("2026-09-07")];
    const result = applyWeeklyCarouselCap(proposed, [], 1);
    expect(result.map((s) => s.slot_type)).toEqual(["carousel", "carousel"]);
  });

  it("never touches a non-carousel slot", () => {
    const proposed = [post("2026-09-01")];
    const result = applyWeeklyCarouselCap(proposed, [carousel("2026-08-31")], 0);
    expect(result[0]!.slot_type).toBe("post");
  });
});

describe("applyReelsPause", () => {
  const slots = [{ slot_type: "reel" }, { slot_type: "post" }, { slot_type: "carousel" }, { slot_type: "reel" }];

  it("passes everything through untouched while the pause is off", () => {
    expect(applyReelsPause(slots, false)).toEqual(slots);
  });

  it("turns every proposed reel into a post while the pause is on", () => {
    expect(applyReelsPause(slots, true).map((s) => s.slot_type)).toEqual(["post", "post", "carousel", "post"]);
  });

  it("does not mutate the proposals it was given", () => {
    const input = [{ slot_type: "reel" }];
    applyReelsPause(input, true);
    expect(input[0]!.slot_type).toBe("reel");
  });
});
