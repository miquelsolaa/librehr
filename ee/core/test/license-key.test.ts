import crypto from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createEeExtensions,
  signLicenseKey,
  verifyLicenseKey,
  type LicensePayload,
} from "../src/index.js";

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const NOW = new Date("2027-03-01T12:00:00.000Z");

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1,
    licensee: "Example Cooperative SCCL",
    edition: "business",
    features: ["sso"],
    issuedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2028-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Encodes arbitrary bytes as a correctly signed token (for schema tests). */
function signRaw(json: string, privatePem: string): string {
  const segment = Buffer.from(json, "utf8").toString("base64url");
  const sig = crypto.sign(
    null,
    Buffer.from(segment, "ascii"),
    crypto.createPrivateKey(privatePem),
  );
  return `${segment}.${sig.toString("base64url")}`;
}

describe("verifyLicenseKey (LIC-002)", () => {
  const keys = keypair();

  it("accepts a valid key and returns its features", () => {
    const token = signLicenseKey(payload(), keys.privatePem);
    expect(verifyLicenseKey(token, keys.publicPem, NOW)).toEqual({
      edition: "business",
      licenseStatus: "valid",
      features: ["sso"],
      licensee: "Example Cooperative SCCL",
      expiresAt: "2028-01-01T00:00:00.000Z",
    });
  });

  it.each([undefined, "", "   "])("treats %j as absent", (token) => {
    expect(verifyLicenseKey(token, keys.publicPem, NOW)).toEqual({
      edition: "community",
      licenseStatus: "absent",
      features: [],
    });
  });

  it("is expired exactly at expiresAt and valid one millisecond before", () => {
    const token = signLicenseKey(payload(), keys.privatePem);
    const expiry = new Date("2028-01-01T00:00:00.000Z");
    expect(
      verifyLicenseKey(token, keys.publicPem, new Date(expiry.getTime() - 1))
        .licenseStatus,
    ).toBe("valid");
    const expired = verifyLicenseKey(token, keys.publicPem, expiry);
    expect(expired.edition).toBe("community");
    expect(expired.licenseStatus).toBe("expired");
    expect(expired.features).toEqual([]);
  });

  it("rejects a key signed by another keypair", () => {
    const other = keypair();
    const token = signLicenseKey(payload(), other.privatePem);
    expect(verifyLicenseKey(token, keys.publicPem, NOW).licenseStatus).toBe(
      "invalid",
    );
  });

  it("fails closed when no public key is embedded", () => {
    const token = signLicenseKey(payload(), keys.privatePem);
    expect(verifyLicenseKey(token, null, NOW).licenseStatus).toBe("invalid");
  });

  it("rejects a public key that is not Ed25519", () => {
    const rsa = crypto
      .generateKeyPairSync("rsa", { modulusLength: 2048 })
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    const token = signLicenseKey(payload(), keys.privatePem);
    expect(verifyLicenseKey(token, rsa, NOW).licenseStatus).toBe("invalid");
    expect(verifyLicenseKey(token, "not a pem", NOW).licenseStatus).toBe(
      "invalid",
    );
  });

  it.each(["abc", "a.b.c", "!!!.???", ".", "abc."])(
    "rejects malformed token %j",
    (token) => {
      expect(verifyLicenseKey(token, keys.publicPem, NOW).licenseStatus).toBe(
        "invalid",
      );
    },
  );

  it("rejects correctly signed payloads that fail the schema", () => {
    for (const json of [
      "not json",
      JSON.stringify({ ...payload(), edition: "enterprise" }),
      JSON.stringify({ ...payload(), v: 2 }),
      JSON.stringify({ ...payload(), expiresAt: "next year" }),
    ]) {
      expect(
        verifyLicenseKey(signRaw(json, keys.privatePem), keys.publicPem, NOW)
          .licenseStatus,
      ).toBe("invalid");
    }
  });

  it("ignores unknown features and duplicates", () => {
    const token = signLicenseKey(
      payload({ features: ["sso", "time-travel", "sso"] }),
      keys.privatePem,
    );
    expect(verifyLicenseKey(token, keys.publicPem, NOW).features).toEqual([
      "sso",
    ]);
  });

  it("is a valid Business licence with no features when none are known", () => {
    const token = signLicenseKey(
      payload({ features: ["time-travel"] }),
      keys.privatePem,
    );
    const state = verifyLicenseKey(token, keys.publicPem, NOW);
    expect(state.edition).toBe("business");
    expect(state.features).toEqual([]);
  });

  it("property: changing any character of a valid token invalidates it", () => {
    const token = signLicenseKey(payload(), keys.privatePem);
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";
    fc.assert(
      fc.property(
        fc.nat({ max: token.length - 1 }),
        fc.constantFrom(...alphabet.split("")),
        (index, replacement) => {
          fc.pre(token[index] !== replacement);
          const tampered =
            token.slice(0, index) + replacement + token.slice(index + 1);
          expect(
            verifyLicenseKey(tampered, keys.publicPem, NOW).licenseStatus,
          ).toBe("invalid");
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("createEeExtensions (LIC-001)", () => {
  const keys = keypair();

  it("runs as Community without a key", () => {
    const bundle = createEeExtensions({ publicKeyPem: keys.publicPem });
    expect(bundle.license.edition).toBe("community");
    expect(bundle.extensions).toEqual([]);
  });

  it("uses the embedded (placeholder) public key by default and fails closed", () => {
    const token = signLicenseKey(payload(), keys.privatePem);
    const bundle = createEeExtensions({ licenseKey: token, now: NOW });
    expect(bundle.license.licenseStatus).toBe("invalid");
  });

  it("reports Business with a valid key", () => {
    const token = signLicenseKey(payload(), keys.privatePem);
    const bundle = createEeExtensions({
      licenseKey: token,
      publicKeyPem: keys.publicPem,
      now: NOW,
    });
    expect(bundle.license.edition).toBe("business");
  });
});
