import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isAllowedEmailDomain } from "../src/sso/oidc.js";

describe("SSO OIDC Helpers", () => {
  it("matches allowed email domains correctly", () => {
    const allowed = ["acme.corp", "acme.es"];

    expect(isAllowedEmailDomain("alice@acme.corp", allowed)).toBe(true);
    expect(isAllowedEmailDomain("BOB@ACME.ES", allowed)).toBe(true);
    expect(isAllowedEmailDomain("attacker@other.com", allowed)).toBe(false);
    expect(isAllowedEmailDomain("invalid-email", allowed)).toBe(false);
  });

  it("accepts only an exact allowed domain, never a look-alike", () => {
    const label = fc.stringMatching(/^[a-z0-9-]{1,12}$/);
    fc.assert(
      fc.property(label, label, fc.string(), (name, base, noise) => {
        const allowed = `${base}.example`;
        expect(isAllowedEmailDomain(`${name}@${allowed}`, [allowed])).toBe(
          true,
        );
        for (const lookAlike of [
          `${name}@${allowed}.evil`,
          `${name}@evil-${allowed}`,
          `${name}@sub.${allowed}`,
          `${name}@${allowed}@x.${allowed}`,
        ]) {
          expect(isAllowedEmailDomain(lookAlike, [allowed])).toBe(false);
        }
        const other = `${name}@${noise}`;
        expect(isAllowedEmailDomain(other, [allowed])).toBe(
          noise.trim().toLowerCase() === allowed,
        );
      }),
    );
  });
});
