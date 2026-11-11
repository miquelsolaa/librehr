import type { LicenseState } from "@librehr/contracts";

/** Licence state of a Community instance (no `ee/`, or no usable key). */
export function communityLicense(): LicenseState {
  return { edition: "community", licenseStatus: "absent", features: [] };
}
