import { describe, expect, it, vi } from "vitest";
import { isSsoEnforcementActive } from "../src/lib/sso-enforcement.js";

// AUTH-004: "Require SSO" is applied only when SSO can actually be used,
// which the licence alone decides (SSO_ENABLED is retired).
describe("isSsoEnforcementActive", () => {
  it("is active when the licence grants sso", () => {
    expect(isSsoEnforcementActive({ features: ["sso"] })).toBe(true);
  });

  it("is inert without a licence granting sso", () => {
    expect(isSsoEnforcementActive({ features: [] })).toBe(false);
  });

  it("does not depend on the retired SSO_ENABLED variable", () => {
    try {
      vi.stubEnv("SSO_ENABLED", "false");
      expect(isSsoEnforcementActive({ features: ["sso"] })).toBe(true);
      vi.stubEnv("SSO_ENABLED", "true");
      expect(isSsoEnforcementActive({ features: [] })).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
