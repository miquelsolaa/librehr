import { describe, expect, it } from "vitest";
import {
  missingClockOutNotification,
  notificationLocale,
} from "../src/notifications/missing-clock-out.js";

describe("missingClockOutNotification (TIM-003)", () => {
  it("renders the catalog copy for each locale with the date", () => {
    expect(missingClockOutNotification("en", "2026-11-02")).toEqual({
      title: "Missing clock-out",
      body: "Your time record for 2026-11-02 is still open. Request a correction with the time you finished.",
    });
    expect(missingClockOutNotification("es", "2026-11-02").title).toBe(
      "Falta el fichaje de salida",
    );
    expect(missingClockOutNotification("ca", "2026-11-02").body).toContain(
      "del 2026-11-02 continua obert",
    );
  });

  it("falls back to ca for an unknown or missing locale", () => {
    const ca = missingClockOutNotification("ca", "2026-11-02");
    expect(missingClockOutNotification("fr", "2026-11-02")).toEqual(ca);
    expect(missingClockOutNotification(undefined, "2026-11-02")).toEqual(ca);
    expect(missingClockOutNotification(null, "2026-11-02")).toEqual(ca);
    expect(notificationLocale("EN")).toBe("ca");
  });

  it("leaves no placeholder in any locale", () => {
    for (const locale of ["ca", "es", "en"]) {
      const { title, body } = missingClockOutNotification(locale, "2026-11-02");
      expect(title).not.toMatch(/[{}]/);
      expect(body).not.toMatch(/[{}]/);
      // ICU would turn '' into ' in the web app; plain substitution would not.
      expect(`${title}${body}`).not.toContain("''");
      expect(body).toContain("2026-11-02");
    }
  });
});
