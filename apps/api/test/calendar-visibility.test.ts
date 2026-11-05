import { describe, expect, it } from "vitest";
import { canSeeLeaveType } from "../src/policies/calendar-visibility.js";

describe("calendar leave-type visibility", () => {
  it("allows administrators, the employee, and their direct manager", () => {
    const record = { employeeUserId: "employee", managerUserId: "manager" };
    expect(canSeeLeaveType({ id: "admin", role: "admin" }, record)).toBe(true);
    expect(canSeeLeaveType({ id: "employee", role: "employee" }, record)).toBe(
      true,
    );
    expect(canSeeLeaveType({ id: "manager", role: "manager" }, record)).toBe(
      true,
    );
  });
  it("masks leave types from unrelated managers and colleagues", () => {
    const record = { employeeUserId: "employee", managerUserId: "manager" };
    expect(canSeeLeaveType({ id: "other", role: "manager" }, record)).toBe(
      false,
    );
    expect(canSeeLeaveType({ id: "other", role: "employee" }, record)).toBe(
      false,
    );
    expect(
      canSeeLeaveType(
        { id: "other", role: "manager" },
        { employeeUserId: null, managerUserId: null },
      ),
    ).toBe(false);
  });
});
