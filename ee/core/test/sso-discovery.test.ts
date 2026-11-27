import { describe, expect, it } from "vitest";
import {
  assertSupportedIssuer,
  createOidcDiscovery,
  parseDiscoveryDocument,
  type OidcHttp,
} from "../src/sso/discovery.js";

const ISSUER = "https://idp.example.invalid/realms/acme";
const TENANT = "0b5e0f8a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

function document(overrides: Record<string, unknown> = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/auth`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/certs`,
    ...overrides,
  };
}

describe("OIDC issuer policy", () => {
  it("accepts https issuers and returns the Entra tenant for Microsoft", () => {
    expect(assertSupportedIssuer("https://accounts.google.com")).toBeNull();
    expect(
      assertSupportedIssuer(
        `https://login.microsoftonline.com/${TENANT.toUpperCase()}/v2.0`,
      ),
    ).toBe(TENANT);
  });

  it.each([
    "http://idp.example.invalid",
    "not a url",
    "https://idp.example.invalid/?x=1",
    "https://login.microsoftonline.com/common/v2.0",
    "https://login.microsoftonline.com/organizations/v2.0",
    "https://login.microsoftonline.com/consumers/v2.0",
    "https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0",
    `https://login.microsoftonline.com/${TENANT}`,
  ])("refuses %s", (issuer) => {
    expect(() => assertSupportedIssuer(issuer)).toThrow(
      expect.objectContaining({ reason: "issuer_not_supported" }),
    );
  });
});

describe("discovery document", () => {
  it("keeps the endpoints and prefers client_secret_basic", () => {
    const metadata = parseDiscoveryDocument(
      document({
        token_endpoint_auth_methods_supported: [
          "client_secret_post",
          "client_secret_basic",
        ],
      }),
      `${ISSUER}/`,
    );
    expect(metadata).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/auth`,
      tokenEndpoint: `${ISSUER}/token`,
      jwksUri: `${ISSUER}/certs`,
      tokenAuthMethod: "client_secret_basic",
      microsoftTenantId: null,
    });
    expect(
      parseDiscoveryDocument(
        document({
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        }),
        ISSUER,
      ).tokenAuthMethod,
    ).toBe("client_secret_post");
  });

  it.each([
    ["an issuer mismatch", { issuer: "https://other.example.invalid" }],
    [
      "an http token endpoint",
      { token_endpoint: "http://idp.example.invalid/t" },
    ],
    [
      "an http authorization endpoint",
      { authorization_endpoint: "http://x.invalid" },
    ],
    ["a missing jwks_uri", { jwks_uri: undefined }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseDiscoveryDocument(document(overrides), ISSUER)).toThrow(
      expect.objectContaining({ reason: "discovery_failed" }),
    );
  });
});

describe("discovery client", () => {
  function fakeHttp(answers: Record<string, unknown>) {
    const urls: string[] = [];
    const http: OidcHttp = ({ url }) => {
      urls.push(url);
      if (!(url in answers)) return Promise.reject(new Error("refused"));
      return Promise.resolve({ status: 200, json: answers[url] });
    };
    return { http, urls };
  }

  it("fetches the well-known document once per TTL", async () => {
    let clock = 0;
    const { http, urls } = fakeHttp({
      [`${ISSUER}/.well-known/openid-configuration`]: document(),
    });
    const discovery = createOidcDiscovery(http, { now: () => clock });
    await discovery.discover(ISSUER);
    clock = 59 * 60 * 1000;
    await discovery.discover(ISSUER);
    expect(urls).toHaveLength(1);
    clock = 61 * 60 * 1000;
    await discovery.discover(ISSUER);
    expect(urls).toHaveLength(2);
  });

  it("turns a refused request or a bad document into discovery_failed", async () => {
    const discovery = createOidcDiscovery(fakeHttp({}).http);
    await expect(discovery.discover(ISSUER)).rejects.toMatchObject({
      reason: "discovery_failed",
    });
    const jwks = `${ISSUER}/certs`;
    const bad = createOidcDiscovery(fakeHttp({ [jwks]: { keys: "x" } }).http);
    await expect(bad.keys(jwks)).rejects.toMatchObject({
      reason: "discovery_failed",
    });
  });

  it("refetches keys on request at most once a minute", async () => {
    let clock = 0;
    const jwks = `${ISSUER}/certs`;
    const { http, urls } = fakeHttp({ [jwks]: { keys: [] } });
    const discovery = createOidcDiscovery(http, { now: () => clock });
    await discovery.keys(jwks);
    await discovery.keys(jwks, true);
    expect(urls).toHaveLength(1);
    clock = 61 * 1000;
    await discovery.keys(jwks, true);
    expect(urls).toHaveLength(2);
  });
});
