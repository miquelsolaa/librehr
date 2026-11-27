import { describe, expect, it } from "vitest";
import { isSsoEnforcementActive } from "../src/lib/sso-enforcement.js";

// AUTH-004: "Require SSO" is applied only when SSO can actually be used.
describe("isSsoEnforcementActive", () => {
  it.each([
    [["sso"] as const, true, true],
    [["sso"] as const, false, false],
    [[] as const, true, false],
    [[] as const, false, false],
  ])("features %j with SSO_ENABLED=%s -> %s", (features, enabled, expected) => {
    expect(isSsoEnforcementActive({ features: [...features] }, enabled)).toBe(
      expected,
    );
  });
});
