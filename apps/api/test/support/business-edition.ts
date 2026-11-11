import crypto from "node:crypto";
import { communityLicense } from "../../src/extensions/community.js";
import type { EditionBundle } from "../../src/extensions/types.js";

/** The fields of a licence payload (mirrors `LicensePayload` in ee/). */
export interface TestLicensePayload {
  v: 1;
  licensee: string;
  edition: "business";
  features: string[];
  issuedAt: string;
  expiresAt: string;
}

interface EeTestModule {
  createEeExtensions: (options: {
    licenseKey?: string | undefined;
    publicKeyPem?: string | undefined;
  }) => EditionBundle;
  signLicenseKey: (
    payload: TestLicensePayload,
    privateKeyPem: string,
  ) => string;
}

// A variable specifier, as in src/extensions/load.ts: the API's tests must
// type-check and run in a Community build where ee/ does not exist (LIC-002).
const EE_MODULE = "@librehr/ee";
const ee: EeTestModule | null = await import(EE_MODULE).then(
  (mod) => mod as EeTestModule,
  () => null,
);

/** False in a Community build; Business-only tests skip themselves. */
export const hasBusinessEdition = ee !== null;

/** Signs a licence key with ee's signer. Only call when `hasBusinessEdition`. */
export function signTestLicense(
  payload: TestLicensePayload,
  privateKeyPem: string,
): string {
  if (!ee) throw new Error("ee/ is not present in this build");
  return ee.signLicenseKey(payload, privateKeyPem);
}

/**
 * A Business edition licensed for `features` (LIC-002), signed by a
 * throwaway keypair. Spread into `createApp` deps as `{ license, extensions }`.
 * In a Community build it returns the Community edition.
 */
export function businessEdition(features: string[] = ["sso"]): EditionBundle {
  if (!ee) return { license: communityLicense(), extensions: [] };
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const licenseKey = ee.signLicenseKey(
    {
      v: 1,
      licensee: "Test Licensee",
      edition: "business",
      features,
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  return ee.createEeExtensions({
    licenseKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
}
