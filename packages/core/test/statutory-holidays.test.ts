import { describe, it, expect } from "vitest";
import {
  getNationalHolidays,
  getRegionalHolidays,
  getMunicipalHolidays,
  resolveLocationHolidays,
} from "../src/index.js";

describe("Statutory Spanish Holiday Calendars (LEA-003)", () => {
  it("generates canonical national holidays including Good Friday", () => {
    const national2026 = getNationalHolidays(2026);
    expect(national2026.length).toBeGreaterThanOrEqual(9);

    const dates = national2026.map((h) => h.date);
    expect(dates).toContain("2026-01-01");
    expect(dates).toContain("2026-01-06");
    expect(dates).toContain("2026-04-03"); // Divendres Sant 2026
    expect(dates).toContain("2026-05-01");
    expect(dates).toContain("2026-08-15");
    expect(dates).toContain("2026-10-12");
    expect(dates).toContain("2026-11-01");
    expect(dates).toContain("2026-12-06");
    expect(dates).toContain("2026-12-08");
    expect(dates).toContain("2026-12-25");
  });

  it("resolves regional holidays for Catalonia vs Madrid", () => {
    const ctHolidays = getRegionalHolidays(2026, "CT");
    const mdHolidays = getRegionalHolidays(2026, "MD");

    const ctNames = ctHolidays.map((h) => h.name);
    expect(ctNames).toContain("Sant Joan");
    expect(ctNames).toContain("Diada Nacional de Catalunya");
    expect(ctNames).toContain("Sant Esteve");

    const mdNames = mdHolidays.map((h) => h.name);
    expect(mdNames).toContain("Fiesta de la Comunidad de Madrid");
    expect(mdNames).toContain("Jueves Santo");
  });

  it("resolves municipal local holidays for Barcelona vs Madrid", () => {
    const bcn = getMunicipalHolidays(2026, "Barcelona");
    const mad = getMunicipalHolidays(2026, "Madrid");

    expect(bcn.some((h) => h.name.includes("Mercè"))).toBe(true);
    expect(mad.some((h) => h.name.includes("San Isidro"))).toBe(true);
    expect(mad.some((h) => h.name.includes("Almudena"))).toBe(true);
  });

  it("combines 3-tier statutory holidays for a specific work center", () => {
    const bcnLocation = resolveLocationHolidays({
      year: 2026,
      region: "CT",
      city: "Barcelona",
    });

    const dates = bcnLocation.map((h) => h.date);
    // National
    expect(dates).toContain("2026-01-01");
    // Regional
    expect(dates).toContain("2026-06-24");
    expect(dates).toContain("2026-09-11");
    // Local (La Mercè)
    expect(dates).toContain("2026-09-24");

    // Must be chronologically sorted
    for (let i = 0; i < bcnLocation.length - 1; i++) {
      expect(bcnLocation[i]!.date <= bcnLocation[i + 1]!.date).toBe(true);
    }
  });
});
