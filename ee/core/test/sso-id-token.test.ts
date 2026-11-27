import { beforeAll, describe, expect, it } from "vitest";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";
import {
  verifyIdToken,
  type IdTokenExpectations,
  type KeySetLoader,
} from "../src/sso/id-token.js";

const ISSUER = "https://idp.example.invalid/realms/acme";
const TENANT = "0b5e0f8a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const MS_ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const NOW = new Date("2026-11-26T10:00:00Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);

let privateKey: CryptoKey;
let publicJwk: JWK;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

const expected = (over: Partial<IdTokenExpectations> = {}) => ({
  provider: { issuer: ISSUER, microsoftTenantId: null },
  clientId: "client",
  nonce: "nonce-1",
  allowedDomains: ["acme.example"],
  currentDate: NOW,
  ...over,
});

// `undefined` drops a claim (JSON.stringify omits it).
function claims(over: Record<string, unknown> = {}): JWTPayload {
  const payload: Record<string, unknown> = {
    iss: ISSUER,
    aud: "client",
    sub: "subject-1",
    iat: SECONDS - 10,
    exp: SECONDS + 300,
    nonce: "nonce-1",
    email: "Alice@Acme.example",
    email_verified: true,
    ...over,
  };
  return payload as JWTPayload;
}

function sign(payload: JWTPayload, key = privateKey, kid = "k1") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid })
    .sign(key);
}

const keys: KeySetLoader = () => Promise.resolve({ keys: [publicJwk] });

async function reason(token: Promise<string> | string, exp = expected()) {
  try {
    await verifyIdToken(await token, exp, keys);
    return "accepted";
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
}

describe("id_token verification (AUTH-004)", () => {
  it("accepts a valid token and returns issuer, subject and lowercased email", async () => {
    await expect(
      verifyIdToken(await sign(claims()), expected(), keys),
    ).resolves.toEqual({
      issuer: ISSUER,
      subject: "subject-1",
      email: "alice@acme.example",
    });
  });

  it.each([
    ["a wrong issuer", { iss: "https://evil.example.invalid" }],
    ["a wrong audience", { aud: "other-client" }],
    ["several audiences without azp", { aud: ["client", "other"] }],
    ["an azp naming another client", { aud: ["client", "x"], azp: "x" }],
    ["an expired token", { exp: SECONDS - 120 }],
    ["a not-yet-valid token", { nbf: SECONDS + 600 }],
    ["a missing iat", { iat: undefined }],
    ["a missing nonce", { nonce: undefined }],
    ["a nonce mismatch", { nonce: "nonce-2" }],
    ["an empty subject", { sub: "" }],
  ])("rejects %s as token_invalid", async (_label, over) => {
    expect(await reason(sign(claims(over)))).toBe("token_invalid");
  });

  it("rejects a token signed by another key", async () => {
    expect(await reason(sign(claims(), otherKey))).toBe("token_invalid");
  });

  it("rejects alg none and HS256 keyed with the public key", async () => {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "none" })}.${encode(claims())}.`;
    expect(await reason(unsigned)).toBe("token_invalid");
    const hs = new SignJWT(claims())
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .sign(new TextEncoder().encode(JSON.stringify(publicJwk)));
    expect(await reason(hs)).toBe("token_invalid");
  });

  it("refetches the key set once for an unknown kid", async () => {
    const calls: boolean[] = [];
    const rotating: KeySetLoader = (refresh) => {
      calls.push(refresh);
      return Promise.resolve({ keys: refresh ? [publicJwk] : [] });
    };
    await verifyIdToken(await sign(claims()), expected(), rotating);
    expect(calls).toEqual([false, true]);

    calls.length = 0;
    const token = await sign(claims(), privateKey, "unknown");
    await expect(
      verifyIdToken(token, expected(), rotating),
    ).rejects.toMatchObject({ reason: "token_invalid" });
    expect(calls).toEqual([false, true]);
  });

  it.each([
    ["email_verified false", { email_verified: false }],
    ["email_verified missing", { email_verified: undefined }],
    ["no email", { email: undefined }],
  ])("rejects %s as email_not_verified", async (_label, over) => {
    expect(await reason(sign(claims(over)))).toBe("email_not_verified");
  });

  it("rejects an email outside the allowed domains", async () => {
    const token = sign(claims({ email: "eve@acme.example.evil" }));
    expect(await reason(token)).toBe("domain_not_allowed");
  });

  it("checks Google's hd claim against the allowed domains", async () => {
    const google = expected({
      provider: {
        issuer: "https://accounts.google.com",
        microsoftTenantId: null,
      },
    });
    const base = { iss: "https://accounts.google.com" };
    expect(
      await reason(sign(claims({ ...base, hd: "acme.example" })), google),
    ).toBe("accepted");
    expect(
      await reason(sign(claims({ ...base, hd: "other.example" })), google),
    ).toBe("domain_not_allowed");
  });

  it("requires Microsoft tokens to come from the configured tenant", async () => {
    const microsoft = expected({
      provider: { issuer: MS_ISSUER, microsoftTenantId: TENANT },
    });
    const base = {
      iss: MS_ISSUER,
      email_verified: undefined,
      email: undefined,
      preferred_username: "alice@acme.example",
    };
    expect(
      await reason(sign(claims({ ...base, tid: TENANT })), microsoft),
    ).toBe("accepted");
    const otherTenant = "11111111-2222-3333-4444-555555555555";
    expect(
      await reason(sign(claims({ ...base, tid: otherTenant })), microsoft),
    ).toBe("token_invalid");
    expect(await reason(sign(claims(base)), microsoft)).toBe("token_invalid");
  });
});
