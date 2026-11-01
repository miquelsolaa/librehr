import { describe, it, expect } from "vitest";
import { SignInRequestSchema } from "../src/auth.js";
import { Permissions, ROLE_PERMISSIONS } from "../src/permissions.js";

describe("Contracts schemas", () => {
  it("validates valid sign-in payload", () => {
    const valid = SignInRequestSchema.safeParse({
      email: "test@openhr.cat",
      password: "secretPassword123",
    });
    expect(valid.success).toBe(true);
  });

  it("rejects invalid email in sign-in payload", () => {
    const invalid = SignInRequestSchema.safeParse({
      email: "not-an-email",
      password: "123",
    });
    expect(invalid.success).toBe(false);
  });

  it("exports canonical permissions and role mappings", () => {
    expect(Permissions).toContain("employee.read");
    expect(Permissions).toContain("leave.request.read");
    expect(Permissions).toContain("time.clock");
    expect(ROLE_PERMISSIONS["admin"]).toBeDefined();
  });

  it("validates employee creation, update, and termination contracts", async () => {
    const { CreateEmployeeRequestSchema, TerminateEmployeeRequestSchema } =
      await import("../src/employees.js");

    const validEmp = CreateEmployeeRequestSchema.safeParse({
      firstName: "Marta",
      lastName: "Rovira",
      email: "marta@openhr.cat",
      jobTitle: "Product Designer",
    });
    expect(validEmp.success).toBe(true);

    const invalidDate = TerminateEmployeeRequestSchema.safeParse({
      terminationDate: "invalid-date",
      terminationReason: "voluntary_resignation",
    });
    expect(invalidDate.success).toBe(false);

    const validTerm = TerminateEmployeeRequestSchema.safeParse({
      terminationDate: "2026-05-01",
      terminationReason: "voluntary_resignation",
    });
    expect(validTerm.success).toBe(true);
  });

  it("validates setup wizard and invitation schemas", async () => {
    const { SetupWizardRequestSchema } = await import("../src/org.js");
    const { CreateInvitationRequestSchema } =
      await import("../src/invitations.js");

    const validSetup = SetupWizardRequestSchema.safeParse({
      orgName: "Acme Spain",
      orgSlug: "acme-spain",
      adminName: "Admin User",
      adminEmail: "admin@acme.test",
      adminPassword: "StrongPassword123!",
      defaultLocale: "es",
      timezone: "Europe/Madrid",
      legalEntityName: "Acme SL",
      legalEntityCif: "B12345678",
      locationName: "Madrid Central",
      locationCity: "Madrid",
      locationRegion: "MD",
    });
    expect(validSetup.success).toBe(true);

    const validInvite = CreateInvitationRequestSchema.safeParse({
      email: "newhire@acme.test",
      role: "employee",
    });
    expect(validInvite.success).toBe(true);
  });

  it("validates leave request and notification contracts (M2)", async () => {
    const { CreateLeaveRequestSchema, DecideLeaveRequestSchema } =
      await import("../src/leave.js");
    const { NotificationItemSchema } = await import("../src/notifications.js");

    const validReq = CreateLeaveRequestSchema.safeParse({
      leaveTypeId: "00000000-0000-0000-0000-000000000001",
      startDate: "2026-08-03",
      endDate: "2026-08-14",
      halfDayStart: false,
      halfDayEnd: false,
    });
    expect(validReq.success).toBe(true);

    const validDecide = DecideLeaveRequestSchema.safeParse({
      decision: "approve",
    });
    expect(validDecide.success).toBe(true);

    const validNotification = NotificationItemSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000002",
      title: "Leave approved",
      body: "Your leave request for August was approved",
      category: "leave_decision",
      read: false,
      createdAt: new Date().toISOString(),
    });
    expect(validNotification.success).toBe(true);
  });
});
