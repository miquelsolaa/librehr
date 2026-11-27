import type { LicenseState } from "@librehr/contracts";

/**
 * Whether organizations' "Require SSO" setting (AUTH-004) is applied on this
 * instance: only with a licence that grants `sso`, the same condition that
 * makes single sign-on available. Without it, members could not open an SSO
 * session, so enforcing would lock them out; the setting stays stored and
 * takes effect again once the licence grants `sso` (LIC-003: nothing is
 * deleted or hidden when the licence lapses). There is no environment kill
 * switch: operator recovery is documented in docs/guides/sso-enforcement.md.
 *
 * @example
 * isSsoEnforcementActive({ edition: "business", licenseStatus: "valid", features: ["sso"] })
 * // => true
 */
export function isSsoEnforcementActive(
  license: Pick<LicenseState, "features">,
): boolean {
  return license.features.includes("sso");
}
