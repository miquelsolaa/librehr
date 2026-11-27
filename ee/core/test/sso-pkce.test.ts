import { describe, expect, it } from "vitest";
import type { OidcHttp } from "../src/sso/discovery.js";
import {
  buildOidcAuthorizationUrl,
  createLoginSecrets,
  exchangeAuthorizationCode,
  pkceChallenge,
} from "../src/sso/oidc.js";

const URL_SAFE_43 = /^[A-Za-z0-9_-]{43}$/;

describe("PKCE and login secrets (AUTH-004)", () => {
  it("matches the RFC 7636 appendix B S256 vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("creates 32-byte url-safe state, nonce and verifier, fresh each time", () => {
    const first = createLoginSecrets();
    const second = createLoginSecrets();
    for (const value of [first.state, first.nonce, first.codeVerifier]) {
      expect(value).toMatch(URL_SAFE_43);
    }
    expect(first.codeChallenge).toBe(pkceChallenge(first.codeVerifier));
    expect(new Set([first.state, first.nonce, first.codeVerifier]).size).toBe(
      3,
    );
    expect(second.state).not.toBe(first.state);
    expect(second.codeVerifier).not.toBe(first.codeVerifier);
  });

  it("puts the discovered endpoint, nonce and S256 challenge in the URL", () => {
    const url = new URL(
      buildOidcAuthorizationUrl({
        authorizationEndpoint: "https://idp.example.invalid/authorize",
        clientId: "client",
        redirectUri: "https://api.example.invalid/v1/sso/callback",
        state: "s",
        nonce: "n",
        codeChallenge: "c",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://idp.example.invalid/authorize",
    );
    expect(url.searchParams.get("nonce")).toBe("n");
    expect(url.searchParams.get("code_challenge")).toBe("c");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.example.invalid/v1/sso/callback",
    );
  });
});

describe("authorization code exchange", () => {
  const base = {
    clientId: "client id",
    clientSecret: "s3cr:t",
    code: "the-code",
    redirectUri: "https://api.example.invalid/v1/sso/callback",
    codeVerifier: "verifier",
  };
  const provider = {
    tokenEndpoint: "https://idp.example.invalid/token",
    tokenAuthMethod: "client_secret_basic" as const,
  };

  function recorder(answer: Awaited<ReturnType<OidcHttp>> | Error) {
    const calls: Parameters<OidcHttp>[0][] = [];
    const http: OidcHttp = (request) => {
      calls.push(request);
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    };
    return { http, calls };
  }

  it("posts the code and verifier with client_secret_basic", async () => {
    const { http, calls } = recorder({ status: 200, json: { id_token: "t" } });
    await expect(
      exchangeAuthorizationCode(http, { ...base, provider }),
    ).resolves.toBe("t");
    const [call] = calls;
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(provider.tokenEndpoint);
    const form = new URLSearchParams(call?.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toBe("verifier");
    expect(form.get("redirect_uri")).toBe(base.redirectUri);
    expect(form.has("client_secret")).toBe(false);
    const basic = call?.headers?.["Authorization"]?.replace("Basic ", "");
    expect(Buffer.from(basic ?? "", "base64").toString()).toBe(
      "client+id:s3cr%3At",
    );
  });

  it("sends the secret in the form when only client_secret_post is offered", async () => {
    const { http, calls } = recorder({ status: 200, json: { id_token: "t" } });
    await exchangeAuthorizationCode(http, {
      ...base,
      provider: { ...provider, tokenAuthMethod: "client_secret_post" },
    });
    const form = new URLSearchParams(calls[0]?.body);
    expect(form.get("client_secret")).toBe("s3cr:t");
    expect(calls[0]?.headers?.["Authorization"]).toBeUndefined();
  });

  it.each([
    ["a 400 answer", { status: 400, json: { error: "invalid_grant" } }],
    ["a 500 answer", { status: 500, json: null }],
    ["no id_token", { status: 200, json: { access_token: "a" } }],
    ["a refused or timed-out request", new Error("timeout")],
  ])("fails with exchange_failed on %s", async (_label, answer) => {
    const { http } = recorder(answer);
    await expect(
      exchangeAuthorizationCode(http, { ...base, provider }),
    ).rejects.toMatchObject({ reason: "exchange_failed" });
  });
});
