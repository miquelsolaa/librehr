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
});
