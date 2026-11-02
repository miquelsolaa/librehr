import { describe, it, expect } from "vitest";
import {
  isAllowedEmailDomain,
  buildOidcAuthorizationUrl,
  decodeJwtClaims,
} from "../src/identity/sso.js";

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

  it("decodes unverified JWT claims safely", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user-123",
        email: "alice@acme.corp",
        name: "Alice Smith",
      }),
    ).toString("base64url");
    const fakeToken = `${header}.${payload}.sig`;

    const claims = decodeJwtClaims(fakeToken);
    expect(claims).not.toBeNull();
    expect(claims?.["email"]).toBe("alice@acme.corp");
    expect(claims?.["name"]).toBe("Alice Smith");
    expect(claims?.["sub"]).toBe("user-123");
  });
});
