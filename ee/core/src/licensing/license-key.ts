import crypto from "node:crypto";
import { z } from "zod";
import {
  BusinessFeatureSchema,
  type BusinessFeature,
  type LicenseState,
} from "@librehr/contracts";

/**
 * Signed content of a licence key. Instants are RFC 3339 UTC. `features`
 * may name features this version does not know; they are ignored.
 */
export const LicensePayloadSchema = z.object({
  v: z.literal(1),
  licensee: z.string().min(1).max(200),
  edition: z.literal("business"),
  features: z.array(z.string().min(1).max(64)).max(64),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

/** Licence state of an instance without a usable key. */
export function communityState(
  status: LicenseState["licenseStatus"] = "absent",
): LicenseState {
  return { edition: "community", licenseStatus: status, features: [] };
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Strict base64url decoding: rejects foreign characters and non-canonical
 * encodings, so every token has exactly one valid spelling.
 */
function decodeBase64Url(segment: string): Buffer | null {
  if (!BASE64URL.test(segment)) return null;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : null;
}

function loadEd25519PublicKey(pem: string): crypto.KeyObject | null {
  try {
    const key = crypto.createPublicKey(pem);
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a LibreHR licence key offline (LIC-002). The token is
 * `base64url(payloadJson) + "." + base64url(ed25519Signature)`, where the
 * signature covers the first segment as ASCII. No network call is made.
 *
 * Anything other than a well-formed, correctly signed, unexpired key yields
 * a Community state; the key is never echoed back.
 *
 * @example
 * verifyLicenseKey(process.env.LIBREHR_LICENSE_KEY, PUBLIC_KEY_PEM, new Date());
 * // => { edition: "business", licenseStatus: "valid", features: ["sso"], ... }
 */
export function verifyLicenseKey(
  token: string | undefined,
  publicKeyPem: string | null,
  now: Date,
): LicenseState {
  const trimmed = token?.trim();
  if (!trimmed) return communityState("absent");

  const publicKey = publicKeyPem ? loadEd25519PublicKey(publicKeyPem) : null;
  if (!publicKey) return communityState("invalid");

  const parts = trimmed.split(".");
  if (parts.length !== 2) return communityState("invalid");
  const [payloadSegment, signatureSegment] = parts as [string, string];
  const payloadBytes = decodeBase64Url(payloadSegment);
  const signature = decodeBase64Url(signatureSegment);
  if (!payloadBytes || !signature) return communityState("invalid");

  let signatureOk = false;
  try {
    signatureOk = crypto.verify(
      null,
      Buffer.from(payloadSegment, "ascii"),
      publicKey,
      signature,
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return communityState("invalid");

  let json: unknown;
  try {
    json = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return communityState("invalid");
  }
  const parsed = LicensePayloadSchema.safeParse(json);
  if (!parsed.success) return communityState("invalid");
  const payload = parsed.data;

  const expiresAt = new Date(payload.expiresAt);
  if (now.getTime() >= expiresAt.getTime()) {
    return {
      ...communityState("expired"),
      licensee: payload.licensee,
      expiresAt: expiresAt.toISOString(),
    };
  }

  const features = [
    ...new Set(
      payload.features.filter(
        (f): f is BusinessFeature => BusinessFeatureSchema.safeParse(f).success,
      ),
    ),
  ];
  return {
    edition: "business",
    licenseStatus: "valid",
    features,
    licensee: payload.licensee,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Signs a licence payload with an Ed25519 private key (PEM). Used by the
 * issuing script and by tests; production private keys never enter the repo.
 */
export function signLicenseKey(
  payload: LicensePayload,
  privateKeyPem: string,
): string {
  const valid = LicensePayloadSchema.parse(payload);
  const payloadSegment = Buffer.from(JSON.stringify(valid), "utf8").toString(
    "base64url",
  );
  const signature = crypto.sign(
    null,
    Buffer.from(payloadSegment, "ascii"),
    crypto.createPrivateKey(privateKeyPem),
  );
  return `${payloadSegment}.${signature.toString("base64url")}`;
}
