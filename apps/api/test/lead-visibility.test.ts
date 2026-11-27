import { describe, expect, it } from "vitest";
import type { Permission } from "@librehr/contracts";
import { Permissions } from "@librehr/contracts";
import type { EmployeeProfile as EmployeeProfileRow } from "@librehr/db";
import type { PolicyUserContext } from "../src/policies/can.js";
import { isInDocumentAudience } from "../src/policies/documents.js";
import {
  employeeProfileView,
  toEmployeeProfile,
} from "../src/policies/employee-visibility.js";
import {
  LEAD_READABLE,
  canReadAsLead,
} from "../src/policies/lead-visibility.js";

// ORG-007 (ADR 0008 decisions 7-9): lead visibility and document audiences
// across secondary departments, without a database.
const org = "org-1";
const lead = (
  role: string,
  extra: Partial<PolicyUserContext> = {},
): PolicyUserContext => ({
  userId: "user-lead",
  employeeId: "emp-lead",
  organizationId: org,
  role,
  reports: [],
  leadVisibility: "profile",
  ledMemberIds: ["emp-member"],
  ...extra,
});

const row = (id: string): EmployeeProfileRow => ({
  id,
  organizationId: org,
  userId: "user-member",
  departmentId: "dept-1",
  managerId: "emp-boss",
  locationId: null,
  firstName: "Fixture",
  lastName: "Member",
  preferredName: null,
  email: "member@example.invalid",
  phone: "+34 600 000 000",
  address: "Street 1",
  birthDate: "1990-01-01",
  status: "active",
  terminationDate: null,
  terminationReason: null,
  nationalIdEncrypted: "v1:ciphertext",
  ibanEncrypted: "v1:ciphertext",
  pinHash: null,
  pinSalt: null,
  badgeId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  departmentName: "Sales",
  locationName: null,
  managerName: "Boss",
  jobTitle: "Engineer",
  employmentType: "full_time",
  workingHoursPerWeek: 40,
  startDate: "2024-01-01",
  hasNationalId: true,
  hasIban: true,
});

describe("canReadAsLead (ORG-007)", () => {
  it("lets a lead read a member's profile only with the profile setting", () => {
    expect(canReadAsLead(lead("employee"), "employee.read", "emp-member")).toBe(
      true,
    );
    for (const leadVisibility of ["off", "calendar", undefined] as const) {
      expect(
        canReadAsLead(
          lead("employee", { leadVisibility }),
          "employee.read",
          "emp-member",
        ),
      ).toBe(false);
    }
  });

  it("never reaches people the user does not lead", () => {
    expect(canReadAsLead(lead("employee"), "employee.read", "emp-other")).toBe(
      false,
    );
    expect(
      canReadAsLead(
        lead("employee", { ledMemberIds: undefined }),
        "employee.read",
        "emp-member",
      ),
    ).toBe(false);
  });

  it("allows only the read allow-list, never write, approve or sensitive", () => {
    const denied = Permissions.filter((p) => !LEAD_READABLE.has(p));
    expect(denied).toContain("employee.write");
    expect(denied).toContain("employee.read_sensitive");
    expect(denied).toContain("leave.request.approve");
    for (const permission of denied as Permission[]) {
      expect(canReadAsLead(lead("admin"), permission, "emp-member")).toBe(
        false,
      );
    }
  });

  it("does not grant a permission the role lacks", () => {
    // The auditor role holds no employee.read at any scope.
    expect(canReadAsLead(lead("auditor"), "employee.read", "emp-member")).toBe(
      false,
    );
  });
});

describe("lead profile view (ORG-007)", () => {
  it("returns a directory view with no personal or sensitive data", () => {
    const view = employeeProfileView(lead("employee"), row("emp-member"));
    expect(view).toBe("directory");
    const profile = toEmployeeProfile(row("emp-member"), "directory");
    expect(profile).toMatchObject({
      firstName: "Fixture",
      email: "member@example.invalid",
      jobTitle: "Engineer",
      departmentName: "Sales",
      userId: null,
      phone: null,
      address: null,
      birthDate: null,
      terminationReason: null,
      employmentType: null,
      workingHoursPerWeek: null,
      startDate: null,
      hasNationalId: false,
      hasIban: false,
    });
    expect(JSON.stringify(profile)).not.toContain("ciphertext");
  });

  it("denies the profile with calendar or off, and to non-members", () => {
    const calendar = lead("employee", { leadVisibility: "calendar" });
    expect(employeeProfileView(calendar, row("emp-member"))).toBeNull();
    expect(employeeProfileView(lead("employee"), row("emp-other"))).toBeNull();
  });

  it("keeps the manager's richer view when the role already allows it", () => {
    const manager = lead("manager", { reports: ["emp-member"] });
    expect(employeeProfileView(manager, row("emp-member"))).toBe("job");
  });
});

describe("department document audience (ORG-007, DOC-002)", () => {
  const doc = {
    organizationId: org,
    employeeId: null,
    category: "policies",
    audienceType: "department",
    targetDepartmentId: "dept-2",
    targetLocationId: null,
  };

  it("reaches active secondary department members", () => {
    const ctx = lead("employee", {
      departmentId: "dept-1",
      departmentIds: ["dept-1", "dept-2"],
    });
    expect(isInDocumentAudience(ctx, doc)).toBe(true);
  });

  it("falls back to the primary department and fails closed otherwise", () => {
    const primaryOnly = lead("employee", { departmentId: "dept-2" });
    expect(isInDocumentAudience(primaryOnly, doc)).toBe(true);
    const elsewhere = lead("employee", {
      departmentId: "dept-1",
      departmentIds: ["dept-1"],
    });
    expect(isInDocumentAudience(elsewhere, doc)).toBe(false);
    expect(
      isInDocumentAudience(lead("employee", { departmentIds: [] }), {
        ...doc,
        targetDepartmentId: null,
      }),
    ).toBe(false);
  });
});
