import type { LicenseState } from "@librehr/contracts";
import type { EeApiExtension } from "./extension.js";
import { verifyLicenseKey } from "./licensing/license-key.js";
import { LIBREHR_LICENSE_PUBLIC_KEY_PEM } from "./licensing/public-key.js";
import { ssoExtension } from "./sso/routes.js";

export {
  communityState,
  LicensePayloadSchema,
  signLicenseKey,
  verifyLicenseKey,
  type LicensePayload,
} from "./licensing/license-key.js";
export { LIBREHR_LICENSE_PUBLIC_KEY_PEM } from "./licensing/public-key.js";
export type {
  EeApiExtension,
  EeExtensionContext,
  ProblemInit,
} from "./extension.js";

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

export interface EeBundle {
  license: LicenseState;
  /** Only extensions whose feature the licence grants. */
  extensions: EeApiExtension[];
}

/** All Business API extensions shipped in this version. */
const ALL_EXTENSIONS: EeApiExtension[] = [ssoExtension];

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
