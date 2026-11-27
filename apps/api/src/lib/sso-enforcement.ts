import type { LicenseState } from "@librehr/contracts";

/**
 * Whether organizations' "Require SSO" setting (AUTH-004) is applied on this
 * instance: only with a licence that grants `sso` and SSO_ENABLED on. Without
 * either, single sign-on cannot be used, so enforcing it would lock members
 * out; the setting stays stored and takes effect again once both hold
 * (LIC-003: nothing is deleted or hidden when the licence lapses).
 * Setting SSO_ENABLED=false is also the operator's last-resort break-glass.
 *
 * @example
 * isSsoEnforcementActive({ edition: "business", licenseStatus: "valid", features: ["sso"] }, true)
 * // => true
 */
export function isSsoEnforcementActive(
  license: Pick<LicenseState, "features">,
  ssoEnabled: boolean,
): boolean {
  return ssoEnabled && license.features.includes("sso");
}
