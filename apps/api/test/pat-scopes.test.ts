import { describe, expect, it } from "vitest";
import {
  normalizePatScopes,
  patScopeAllows,
} from "../src/middleware/pat-scopes.js";

describe("personal access token scopes (ADM-006)", () => {
  it("limits read tokens to safe methods", () => {
    expect(patScopeAllows(["read"], "GET", "/v1/employees")).toBe(true);
    expect(patScopeAllows(["read"], "POST", "/v1/leave/requests")).toBe(false);
    expect(patScopeAllows(["read"], "PATCH", "/v1/employees/x")).toBe(false);
  });

  it("lets write tokens change data outside admin route groups", () => {
    expect(patScopeAllows(["write"], "POST", "/v1/leave/requests")).toBe(true);
    expect(patScopeAllows(["write"], "GET", "/v1/audit")).toBe(false);
    expect(patScopeAllows(["write"], "POST", "/v1/employees/import")).toBe(
      false,
    );
    expect(patScopeAllows(["write"], "POST", "/v1/employees/abc/reveal")).toBe(
      false,
    );
  });

  it("requires the admin scope for admin route groups", () => {
    expect(patScopeAllows(["admin"], "GET", "/v1/audit")).toBe(true);
    expect(patScopeAllows(["admin"], "GET", "/v1/employees/a/dsr-export")).toBe(
      true,
    );
  });

  it("never reaches credential or account-security endpoints", () => {
    for (const path of [
      "/v1/tokens",
      "/v1/auth/2fa/disable",
      "/v1/settings/security",
      "/v1/sso/config",
      "/v1/setup",
      "/v1/org/setup-wizard",
    ]) {
      expect(patScopeAllows(["read", "write", "admin"], "GET", path)).toBe(
        false,
      );
    }
  });

  it("grants nothing for unknown or malformed scopes", () => {
    expect(patScopeAllows(["everything"], "GET", "/v1/employees")).toBe(false);
    expect(normalizePatScopes('["read"]')).toEqual(["read"]);
    expect(normalizePatScopes("not json")).toEqual([]);
    expect(normalizePatScopes({ read: true })).toEqual([]);
  });
});
