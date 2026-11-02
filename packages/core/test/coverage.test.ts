import { describe, it, expect } from "vitest";
import {
  checkBlackoutDate,
  evaluateTeamCoverage,
  type BlackoutPeriod,
} from "../src/leave/index.js";

describe("Team Coverage and Blackout Rules (LEA-007)", () => {
  describe("checkBlackoutDate", () => {
    const blackouts: BlackoutPeriod[] = [
      {
        startDate: "2026-11-20",
        endDate: "2026-11-30",
        reason: "Black Friday operations peak",
      },
      {
        startDate: "2026-12-24",
        endDate: "2026-12-31",
        reason: "Year-end financial closing",
      },
    ];

    it("detects dates inside a blackout window", () => {
      const res = checkBlackoutDate("2026-11-25", blackouts);
      expect(res.inBlackout).toBe(true);
      expect(res.reason).toBe("Black Friday operations peak");
    });

    it("allows dates outside blackout windows", () => {
      const res = checkBlackoutDate("2026-11-15", blackouts);
      expect(res.inBlackout).toBe(false);
      expect(res.reason).toBeUndefined();
    });

    it("respects boundary dates of blackout windows", () => {
      expect(checkBlackoutDate("2026-11-20", blackouts).inBlackout).toBe(true);
      expect(checkBlackoutDate("2026-11-30", blackouts).inBlackout).toBe(true);
      expect(checkBlackoutDate("2026-12-01", blackouts).inBlackout).toBe(false);
    });
  });

  describe("evaluateTeamCoverage", () => {
    it("allows absence when team coverage criteria are met", () => {
      const res = evaluateTeamCoverage({
        teamSize: 10,
        activeAbsencesOnDate: 2,
        minPresencePercent: 60,
        maxAbsenceCount: 4,
      });

      // 10 team size, 2 already absent + 1 new = 3 absent (7 present = 70%)
      expect(res.allowed).toBe(true);
      expect(res.presencePercent).toBe(70);
      expect(res.projectedAbsences).toBe(3);
    });

    it("blocks request when minPresencePercent threshold is breached", () => {
      const res = evaluateTeamCoverage({
        teamSize: 5,
        activeAbsencesOnDate: 2,
        minPresencePercent: 60, // requires at least 3 present (60%)
      });

      // 2 already absent + 1 new = 3 absent (2 present = 40%)
      expect(res.allowed).toBe(false);
      expect(res.presencePercent).toBe(40);
      expect(res.reason).toContain(
        "below the required minimum threshold of 60%",
      );
    });

    it("blocks request when maxAbsenceCount is exceeded", () => {
      const res = evaluateTeamCoverage({
        teamSize: 10,
        activeAbsencesOnDate: 2,
        maxAbsenceCount: 2,
      });

      // 2 already absent + 1 new = 3 absent > max 2
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain(
        "Maximum team absence limit of 2 employees reached",
      );
    });
  });
});
