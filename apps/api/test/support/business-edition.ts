import crypto from "node:crypto";
import { createEeExtensions, signLicenseKey } from "@librehr/ee";
import type { EditionBundle } from "../../src/extensions/types.js";

/**
 * A Business edition licensed for `features` (LIC-002), signed by a
 * throwaway keypair. Spread into `createApp` deps as `{ license, extensions }`.
 * Typed as the API's bundle, which keeps ee's extension shape in sync.
 */
export function businessEdition(features: string[] = ["sso"]): EditionBundle {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const licenseKey = signLicenseKey(
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
  const bundle: EditionBundle = createEeExtensions({
    licenseKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  return bundle;
}
