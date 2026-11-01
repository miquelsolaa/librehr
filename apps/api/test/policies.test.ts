import { describe, it, expect } from "vitest";
import {
  can,
  type PolicyUserContext,
  type PolicyResource,
} from "../src/policies/can.js";

describe("Policy Authorization & Scope Model (can)", () => {
  const orgA = "org-a000-0000-0000";
  const orgB = "org-b000-0000-0000";

  const employeeCtx: PolicyUserContext = {
    userId: "user-laia",
    employeeId: "emp-laia",
    organizationId: orgA,
    role: "employee",
    departmentId: "dept-dev",
  };

  const managerCtx: PolicyUserContext = {
    userId: "user-pere",
    employeeId: "emp-pere",
    organizationId: orgA,
    role: "manager",
    departmentId: "dept-dev",
    reports: ["emp-laia"],
  };

  const adminCtx: PolicyUserContext = {
    userId: "user-marta",
    employeeId: "emp-marta",
    organizationId: orgA,
    role: "admin",
  };

  it("allows employee to read own records but blocks reading peer records", () => {
    const ownRecord: PolicyResource = {
      organizationId: orgA,
      userId: "user-laia",
      employeeId: "emp-laia",
    };

    const peerRecord: PolicyResource = {
      organizationId: orgA,
      userId: "user-other",
      employeeId: "emp-other",
    };

    expect(can(employeeCtx, "employee.read", ownRecord)).toBe(true);
    expect(can(employeeCtx, "employee.read", peerRecord)).toBe(false);
  });

  it("allows manager to approve leave for direct report but blocks for non-report", () => {
    const directReportLeave: PolicyResource = {
      organizationId: orgA,
      employeeId: "emp-laia",
      managerId: "user-pere",
    };

    const strangerLeave: PolicyResource = {
      organizationId: orgA,
      employeeId: "emp-stranger",
      managerId: "user-other",
    };

    expect(can(managerCtx, "leave.request.approve", directReportLeave)).toBe(
      true,
    );
    expect(can(managerCtx, "leave.request.approve", strangerLeave)).toBe(false);
  });

  it("allows admin full organization-scoped access", () => {
    const anyOrgRecord: PolicyResource = {
      organizationId: orgA,
      userId: "user-stranger",
    };

    expect(can(adminCtx, "employee.read", anyOrgRecord)).toBe(true);
    expect(can(adminCtx, "org.write", anyOrgRecord)).toBe(true);
  });

  it("strictly blocks cross-tenant access even for organization-scoped admins", () => {
    const orgBRecord: PolicyResource = {
      organizationId: orgB,
      userId: "user-in-org-b",
    };

    expect(can(adminCtx, "employee.read", orgBRecord)).toBe(false);
    expect(can(adminCtx, "org.read", orgBRecord)).toBe(false);
  });
});
