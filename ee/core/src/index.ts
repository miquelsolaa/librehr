import type { BusinessFeature, LicenseState } from "@librehr/contracts";
import { verifyLicenseKey } from "./licensing/license-key.js";
import { LIBREHR_LICENSE_PUBLIC_KEY_PEM } from "./licensing/public-key.js";

export {
  communityState,
  LicensePayloadSchema,
  signLicenseKey,
  verifyLicenseKey,
  type LicensePayload,
} from "./licensing/license-key.js";
export { LIBREHR_LICENSE_PUBLIC_KEY_PEM } from "./licensing/public-key.js";

export interface EeOptions {
  /** LIBREHR_LICENSE_KEY. */
  licenseKey?: string | undefined;
  /**
   * Overrides the embedded public key. The API only passes it outside
   * production (LIBREHR_LICENSE_PUBLIC_KEY) and in tests.
   */
  publicKeyPem?: string | undefined;
  now?: Date | undefined;
}

/**
 * A Business feature's API routes. Structurally identical to the API's
 * `ApiExtension` (apps/api/src/extensions/types.ts); `ee/` cannot import the
 * API, so the shape is kept in sync by the API's type check.
 */
export interface EeApiExtension<Router = unknown, Context = unknown> {
  feature: BusinessFeature;
  register: (router: Router, context: Context) => void;
}

export interface EeBundle {
  license: LicenseState;
  /** Only extensions whose feature the licence grants. */
  extensions: EeApiExtension[];
}

/** All Business API extensions shipped in this version. */
const ALL_EXTENSIONS: EeApiExtension[] = [];

/**
 * Entry point used by the API extension loader (LIC-001/002): verifies the
 * licence offline and returns the extensions it unlocks.
 */
export function createEeExtensions(options: EeOptions = {}): EeBundle {
  const license = verifyLicenseKey(
    options.licenseKey,
    options.publicKeyPem ?? LIBREHR_LICENSE_PUBLIC_KEY_PEM,
    options.now ?? new Date(),
  );
  const extensions = ALL_EXTENSIONS.filter((ext) =>
    license.features.includes(ext.feature),
  );
  return { license, extensions };
}
