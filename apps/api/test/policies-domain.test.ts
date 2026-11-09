import { describe, expect, it } from "vitest";
import type { PolicyUserContext } from "../src/policies/can.js";
import { canToggleChecklistTask } from "../src/policies/checklists.js";
import {
  canSeeCustomField,
  canWriteCustomFields,
  customFieldViewer,
} from "../src/policies/custom-fields.js";
import {
  canListDocument,
  canReadDocument,
  isInDocumentAudience,
} from "../src/policies/documents.js";

const org = "org-1";
const ctx = (role: string, extra: Partial<PolicyUserContext> = {}) => ({
  userId: `user-${role}`,
  employeeId: `emp-${role}`,
  organizationId: org,
  role,
  reports: role === "manager" ? ["emp-employee"] : [],
  ...extra,
});
const employeeRow = (id: string, managerId: string | null = null) => ({
  id,
  organizationId: org,
  userId: null,
  managerId,
  departmentId: null,
  locationId: null,
});

describe("document policy (DOC-003)", () => {
  const personal = {
    organizationId: org,
    employeeId: "emp-employee",
    category: "contracts",
    audienceType: "individual",
    targetDepartmentId: null,
    targetLocationId: null,
  };
  const payslip = { ...personal, category: "payslips" };

  it("lets owners and HR read personal documents, not managers", () => {
    expect(canReadDocument(ctx("employee"), personal)).toBe(true);
    expect(canReadDocument(ctx("admin"), personal)).toBe(true);
    expect(canReadDocument(ctx("manager"), personal)).toBe(false);
    expect(canReadDocument(ctx("auditor"), personal)).toBe(false);
  });

  it("limits payslip content to the owner and payroll", () => {
    expect(canReadDocument(ctx("employee"), payslip)).toBe(true);
    expect(canReadDocument(ctx("payroll"), payslip)).toBe(true);
    expect(canReadDocument(ctx("admin"), payslip)).toBe(false);
    expect(canListDocument(ctx("admin"), payslip)).toBe(true);
    expect(canListDocument(ctx("manager"), payslip)).toBe(false);
  });

  it("targets company documents by audience", () => {
    const dept = {
      ...personal,
      employeeId: null,
      audienceType: "department",
      targetDepartmentId: "dept-1",
    };
    expect(
      isInDocumentAudience(ctx("employee", { departmentId: "dept-1" }), dept),
    ).toBe(true);
    expect(isInDocumentAudience(ctx("employee"), dept)).toBe(false);
    expect(
      canReadDocument(ctx("employee"), { ...dept, organizationId: "org-2" }),
    ).toBe(false);
  });
});

describe("custom field policy (ORG-005)", () => {
  it("derives the viewer relationship", () => {
    const report = employeeRow("emp-employee", "emp-manager");
    expect(customFieldViewer(ctx("employee"), report)).toBe("self");
    expect(customFieldViewer(ctx("manager"), report)).toBe("manager");
    expect(customFieldViewer(ctx("admin"), report)).toBe("admin");
    expect(customFieldViewer(ctx("employee"), employeeRow("emp-x"))).toBe(null);
  });

  it("applies visibility and fails closed on unknown values", () => {
    expect(canSeeCustomField("self", "employee")).toBe(true);
    expect(canSeeCustomField("self", "manager")).toBe(false);
    expect(canSeeCustomField("manager", "hr")).toBe(false);
    expect(canSeeCustomField("hr", "admin")).toBe(false);
    expect(canSeeCustomField("hr", "bogus")).toBe(false);
  });

  it("keeps writes to HR/admin", () => {
    const self = employeeRow("emp-employee");
    expect(canWriteCustomFields(ctx("employee"), self)).toBe(false);
    expect(canWriteCustomFields(ctx("admin"), self)).toBe(true);
  });
});

describe("checklist task policy (ONB-002)", () => {
  const task = (assignedRole: string) => ({
    assignedRole,
    assigneeEmployeeId: null,
    subjectEmployeeId: "emp-employee",
    subjectManagerId: "emp-manager",
  });

  it("lets the owner role toggle and denies others", () => {
    expect(canToggleChecklistTask(ctx("employee"), task("employee"))).toBe(
      true,
    );
    expect(canToggleChecklistTask(ctx("manager"), task("manager"))).toBe(true);
    expect(canToggleChecklistTask(ctx("manager"), task("employee"))).toBe(
      false,
    );
    expect(canToggleChecklistTask(ctx("employee"), task("admin"))).toBe(false);
    expect(canToggleChecklistTask(ctx("admin"), task("employee"))).toBe(true);
  });
});
