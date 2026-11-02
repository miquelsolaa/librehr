import { describe, expect, it } from "vitest";
import { STATUTORY_LEAVE_TYPES } from "../src/leave/statutory.js";

describe("Statutory Leave Catalogue (Estatuto de los Trabajadores & RDL 5/2023)", () => {
  it("includes all 13 core statutory leave types", () => {
    const codes = STATUTORY_LEAVE_TYPES.map((t) => t.code);
    expect(codes).toContain("vacation");
    expect(codes).toContain("personal_days");
    expect(codes).toContain("sick_leave");
    expect(codes).toContain("marriage");
    expect(codes).toContain("hospitalization_family");
    expect(codes).toContain("bereavement");
    expect(codes).toContain("moving");
    expect(codes).toContain("public_duty");
    expect(codes).toContain("prenatal_exams");
    expect(codes).toContain("family_force_majeure");
    expect(codes).toContain("parental_leave_unpaid");
    expect(codes).toContain("birth_childcare");
    expect(codes).toContain("education_exams");
  });

  it("configures legal references for statutory rights", () => {
    const marriage = STATUTORY_LEAVE_TYPES.find((t) => t.code === "marriage");
    expect(marriage?.legalReference).toBe("ET art. 37.3.a");
    expect(marriage?.defaultDays).toBe(15);
    expect(marriage?.isPaid).toBe(true);
    expect(marriage?.requiresAttachment).toBe(true);

    const hosp = STATUTORY_LEAVE_TYPES.find(
      (t) => t.code === "hospitalization_family",
    );
    expect(hosp?.legalReference).toContain("RDL 5/2023");
    expect(hosp?.defaultDays).toBe(5);
    expect(hosp?.countsWorkingDays).toBe(true);

    const forceMajeure = STATUTORY_LEAVE_TYPES.find(
      (t) => t.code === "family_force_majeure",
    );
    expect(forceMajeure?.legalReference).toBe("ET art. 37.9 (RDL 5/2023)");
    expect(forceMajeure?.defaultDays).toBe(4);
    expect(forceMajeure?.isPaid).toBe(true);

    const unpaidParental = STATUTORY_LEAVE_TYPES.find(
      (t) => t.code === "parental_leave_unpaid",
    );
    expect(unpaidParental?.isPaid).toBe(false);
  });

  it("provides complete trilingual titles and descriptions (ca, es, en)", () => {
    for (const def of STATUTORY_LEAVE_TYPES) {
      expect(def.name.ca).toBeTruthy();
      expect(def.name.es).toBeTruthy();
      expect(def.name.en).toBeTruthy();
      expect(def.description.ca).toBeTruthy();
      expect(def.description.es).toBeTruthy();
      expect(def.description.en).toBeTruthy();
    }
  });
});
