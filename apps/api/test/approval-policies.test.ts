import { describe, expect, it } from "vitest";
import type { PolicyUserContext } from "../src/policies/can.js";
import type { ScopedEmployee } from "../src/policies/context.js";
import {
  canDecideCorrection,
  canDecideLeave,
  hasOtherLeaveDecider,
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

describe("hasOtherLeaveDecider (LEA-004 sole-approver exception)", () => {
  const org = "org-a";
  const admin: PolicyUserContext = {
    userId: "user-marta",
    employeeId: "marta",
    organizationId: org,
    role: "admin",
    reports: [],
  };
  const marta = (managerId: string | null = null): ScopedEmployee => ({
    id: "marta",
    organizationId: org,
    userId: "user-marta",
    managerId,
    departmentId: null,
    locationId: null,
  });
  const member = (id: string, role: string) => ({
    userId: `user-${id}`,
    role,
    employeeId: id as string | null,
  });

  it("is false for a sole admin with no manager and no delegate", () => {
    expect(hasOtherLeaveDecider(admin, marta(), [], [])).toBe(false);
    expect(
      hasOtherLeaveDecider(
        admin,
        marta(),
        [
          member("pere", "manager"),
          member("laia", "employee"),
          member("anna", "auditor"),
          member("x", "no-such-role"),
        ],
        [],
      ),
    ).toBe(false);
  });

  it("ignores the caller's own membership", () => {
    expect(
      hasOtherLeaveDecider(admin, marta(), [member("marta", "admin")], []),
    ).toBe(false);
  });

  it("is true when another organization-wide approver exists", () => {
    expect(
      hasOtherLeaveDecider(admin, marta(), [member("jordi", "admin")], []),
    ).toBe(true);
    expect(
      hasOtherLeaveDecider(
        admin,
        marta(),
        [{ userId: "user-x", role: "admin", employeeId: null }],
        [],
      ),
    ).toBe(true);
  });

  it("is true only when the reports-scoped approver is the caller's manager", () => {
    const managers = [member("pere", "manager")];
    expect(hasOtherLeaveDecider(admin, marta("pere"), managers, [])).toBe(true);
    expect(hasOtherLeaveDecider(admin, marta("other"), managers, [])).toBe(
      false,
    );
  });

  it("counts an active delegate of the caller's manager who can sign in", () => {
    const pere = member("pere", "employee");
    const joan = member("joan", "employee");
    expect(
      hasOtherLeaveDecider(admin, marta("pere"), [pere, joan], ["joan"]),
    ).toBe(true);
    // A delegate without a live membership cannot act.
    expect(hasOtherLeaveDecider(admin, marta("pere"), [pere], ["joan"])).toBe(
      false,
    );
    // Delegating to the caller does not create another decider.
    expect(
      hasOtherLeaveDecider(admin, marta("pere"), [pere, joan], ["marta"]),
    ).toBe(false);
  });
});
