import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  isAllowedEmailDomain,
  buildOidcAuthorizationUrl,
} from "../src/sso/oidc.js";

describe("SSO OIDC Helpers", () => {
  it("matches allowed email domains correctly", () => {
    const allowed = ["acme.corp", "acme.es"];

    expect(isAllowedEmailDomain("alice@acme.corp", allowed)).toBe(true);
    expect(isAllowedEmailDomain("BOB@ACME.ES", allowed)).toBe(true);
    expect(isAllowedEmailDomain("attacker@other.com", allowed)).toBe(false);
    expect(isAllowedEmailDomain("invalid-email", allowed)).toBe(false);
  });

  it("constructs proper Google and Microsoft OIDC authorization URLs", () => {
    const googleUrl = buildOidcAuthorizationUrl({
      issuerUrl: "https://accounts.google.com",
      clientId: "google-client-123",
      redirectUri: "https://app.librehr.local/api/v1/sso/callback",
      state: "state-xyz",
    });

    expect(googleUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(googleUrl).toContain("client_id=google-client-123");
    expect(googleUrl).toContain("response_type=code");
    expect(googleUrl).toContain("state=state-xyz");

    const msUrl = buildOidcAuthorizationUrl({
      issuerUrl: "https://login.microsoftonline.com/common/v2.0",
      clientId: "ms-client-456",
      redirectUri: "https://app.librehr.local/api/v1/sso/callback",
      state: "state-abc",
    });

    expect(msUrl).toContain(
      "https://login.microsoftonline.com/common/v2.0/oauth2/v2.0/authorize",
    );
    expect(msUrl).toContain("client_id=ms-client-456");
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

  // CodeQL js/incomplete-url-substring-sanitization: the provider is decided
  // by the issuer's host, not by a substring anywhere in the URL.
  it("does not treat a look-alike issuer as Google or Microsoft", () => {
    const build = (issuerUrl: string) =>
      new URL(
        buildOidcAuthorizationUrl({
          issuerUrl,
          clientId: "client",
          redirectUri: "https://app.example.invalid/cb",
          state: "s",
        }),
      );
    for (const issuer of [
      "https://accounts.google.com.idp.example.invalid",
      "https://idp.example.invalid/accounts.google.com",
      "https://login.microsoftonline.com.idp.example.invalid/tenant",
    ]) {
      const url = build(issuer);
      expect(url.hostname).toBe(new URL(issuer).hostname);
      expect(url.pathname.endsWith("/protocol/openid-connect/auth")).toBe(true);
    }
    expect(build("https://accounts.google.com").href).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    );
    expect(
      build("https://login.microsoftonline.com/tenant/v2.0").pathname,
    ).toBe("/tenant/v2.0/oauth2/v2.0/authorize");
  });

  // CodeQL js/polynomial-redos: a regex trim of trailing "/" is quadratic on
  // long runs of "/" that do not end the string.
  it("trims trailing slashes from the issuer in linear time", () => {
    const build = (issuerUrl: string) =>
      buildOidcAuthorizationUrl({
        issuerUrl,
        clientId: "client",
        redirectUri: "https://app.example.invalid/cb",
        state: "s",
      });
    expect(
      new URL(build("https://idp.example.invalid/realms/x///")).pathname,
    ).toBe("/realms/x/protocol/openid-connect/auth");
    const started = performance.now();
    build(`https://idp.example.invalid/${"/".repeat(200_000)}x`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
