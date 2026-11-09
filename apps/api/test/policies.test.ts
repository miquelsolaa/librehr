import { describe, it, expect } from "vitest";
import {
  can,
  employeeIdsInScope,
  permissionScope,
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
      managerId: "emp-pere",
    };

    const strangerLeave: PolicyResource = {
      organizationId: orgA,
      employeeId: "emp-stranger",
      managerId: "emp-other",
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

describe("can() without a resource (list views)", () => {
  const org = "org-a000-0000-0000";
  const base = { userId: "user-1", employeeId: "emp-1", organizationId: org };

  it("does not grant org-wide access from a self-scoped permission", () => {
    expect(can({ ...base, role: "employee" }, "employee.read")).toBe(false);
  });

  it("does not grant org-wide access from a reports-scoped permission", () => {
    expect(can({ ...base, role: "manager" }, "employee.read")).toBe(false);
  });

  it("grants list access when the permission is organization-scoped", () => {
    expect(can({ ...base, role: "admin" }, "employee.read")).toBe(true);
  });

  it("reports the scope a list view must be filtered to", () => {
    expect(
      permissionScope({ ...base, role: "employee" }, "employee.read"),
    ).toBe("self");
    expect(permissionScope({ ...base, role: "manager" }, "employee.read")).toBe(
      "reports",
    );
    expect(permissionScope({ ...base, role: "auditor" }, "employee.read")).toBe(
      null,
    );
  });
});

describe("reports scope compares employee ids, not user ids", () => {
  const org = "org-a000-0000-0000";
  const manager: PolicyUserContext = {
    userId: "user-pere",
    employeeId: "emp-pere",
    organizationId: org,
    role: "manager",
    reports: [],
  };

  it("allows a manager whose employee id is the resource's managerId", () => {
    expect(
      can(manager, "leave.request.approve", {
        organizationId: org,
        employeeId: "emp-laia",
        managerId: "emp-pere",
      }),
    ).toBe(true);
  });

  it("denies when the managerId happens to equal the manager's user id", () => {
    expect(
      can(manager, "leave.request.approve", {
        organizationId: org,
        employeeId: "emp-laia",
        managerId: "user-pere",
      }),
    ).toBe(false);
  });

  it("lets a manager read but not approve their own records", () => {
    const own = { organizationId: org, employeeId: "emp-pere" };
    expect(can(manager, "leave.request.read", own)).toBe(true);
    expect(can(manager, "leave.request.approve", own)).toBe(false);
    expect(can(manager, "time.record.correct", own)).toBe(false);
  });

  it("denies a manager without a linked employee", () => {
    const unlinked: PolicyUserContext = {
      userId: "user-x",
      organizationId: org,
      role: "manager",
    };
    expect(
      can(unlinked, "leave.request.approve", {
        organizationId: org,
        employeeId: "emp-laia",
      }),
    ).toBe(false);
  });
});

describe("employeeIdsInScope", () => {
  const org = "org-a000-0000-0000";

  it("returns every employee for organization scope", () => {
    expect(
      employeeIdsInScope(
        { userId: "u", organizationId: org, role: "admin" },
        "time.record.read",
      ),
    ).toBe("all");
  });

  it("returns self plus direct reports for managers", () => {
    expect(
      employeeIdsInScope(
        {
          userId: "u",
          employeeId: "e1",
          organizationId: org,
          role: "manager",
          reports: ["e2"],
        },
        "time.record.read",
      ),
    ).toEqual(["e1", "e2"]);
  });

  it("returns only self for employees, and nothing when unlinked or unpermitted", () => {
    const employee = { userId: "u", organizationId: org, role: "employee" };
    expect(
      employeeIdsInScope({ ...employee, employeeId: "e1" }, "time.record.read"),
    ).toEqual(["e1"]);
    expect(employeeIdsInScope(employee, "time.record.read")).toEqual([]);
    expect(
      employeeIdsInScope(
        { userId: "u", employeeId: "e1", organizationId: org, role: "auditor" },
        "employee.read",
      ),
    ).toEqual([]);
  });
});
