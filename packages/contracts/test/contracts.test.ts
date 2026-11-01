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
});
