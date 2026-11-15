import { describe, expect, it } from "vitest";
import type { PolicyUserContext } from "../src/policies/can.js";
import type { ScopedEmployee } from "../src/policies/context.js";
import {
  canDecideCorrection,
  canDecideLeave,
} from "../src/policies/approvals.js";

describe("approval predicates (LEA-004, LEA-008, TIM-003)", () => {
  const org = "org-a";
  const person = (
    id: string,
    managerId: string | null = null,
  ): ScopedEmployee => ({
    id,
    organizationId: org,
    userId: `user-${id}`,
    managerId,
    departmentId: null,
    locationId: null,
  });
  const ctx = (
    id: string,
    role: string,
    reports: string[] = [],
  ): PolicyUserContext => ({
    userId: `user-${id}`,
    employeeId: id,
    organizationId: org,
    role,
    reports,
  });

  const manager = ctx("pere", "manager", ["laia"]);
  const admin = ctx("marta", "admin");
  const delegate = ctx("joan", "employee");
  const auditor = ctx("anna", "auditor");
  const laia = person("laia", "pere");
  const other = person("other", "someone-else");

  it("lets a manager decide a direct report's leave and correction", () => {
    expect(canDecideLeave(manager, laia, [])).toBe(true);
    expect(canDecideCorrection(manager, laia)).toBe(true);
    expect(canDecideLeave(manager, other, [])).toBe(false);
    expect(canDecideCorrection(manager, other)).toBe(false);
  });

  it("never lets anyone decide their own request, admins included", () => {
    expect(canDecideLeave(admin, person("marta"), [])).toBe(false);
    expect(canDecideCorrection(admin, person("marta"))).toBe(false);
    expect(canDecideLeave(manager, person("pere"), [])).toBe(false);
    expect(canDecideLeave(delegate, person("joan", "pere"), ["pere"])).toBe(
      false,
    );
  });

  it("lets a delegate decide leave, but not corrections, for the delegating manager's team", () => {
    expect(canDecideLeave(delegate, laia, ["pere"])).toBe(true);
    expect(canDecideLeave(delegate, laia, [])).toBe(false);
    expect(canDecideLeave(delegate, other, ["pere"])).toBe(false);
    expect(canDecideCorrection(delegate, laia)).toBe(false);
  });

  it("gives auditors and other tenants nothing", () => {
    expect(canDecideLeave(auditor, laia, [])).toBe(false);
    expect(canDecideCorrection(auditor, laia)).toBe(false);
    const foreign = { ...laia, organizationId: "org-b" };
    expect(canDecideLeave(admin, foreign, [])).toBe(false);
    expect(canDecideCorrection(admin, foreign)).toBe(false);
    expect(canDecideLeave(delegate, foreign, ["pere"])).toBe(false);
  });
});
