import { describe, expect, it } from "vitest";
import {
  timeExportFailedNotification,
  timeExportReadyNotification,
} from "../src/notifications/time-export.js";

const period = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

describe("time export notifications (TIM-006)", () => {
  it("renders the ready copy with the period and the last download day", () => {
    expect(
      timeExportReadyNotification("en", {
        ...period,
        availableUntil: "2027-01-08",
      }),
    ).toEqual({
      title: "Time record export ready",
      body: "Your time record export for 2026-01-01 to 2026-12-31 can be downloaded until 2027-01-08.",
    });
  });

  it("renders the failure copy and falls back to ca", () => {
    expect(timeExportFailedNotification("es", period).title).toBe(
      "No se ha podido generar la exportación",
    );
    expect(timeExportFailedNotification("fr", period)).toEqual(
      timeExportFailedNotification("ca", period),
    );
  });

  it("leaves no placeholder in any locale", () => {
    for (const locale of ["ca", "es", "en"]) {
      for (const { title, body } of [
        timeExportReadyNotification(locale, {
          ...period,
          availableUntil: "2027-01-08",
        }),
        timeExportFailedNotification(locale, period),
      ]) {
        expect(`${title}${body}`).not.toMatch(/[{}]/);
        expect(`${title}${body}`).not.toContain("''");
        expect(body).toContain("2026-01-01");
        expect(body).toContain("2026-12-31");
      }
    }
  });
});
