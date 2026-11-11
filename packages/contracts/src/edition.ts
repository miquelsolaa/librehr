import { z } from "zod";

// LIC-001..003: editions and licensing (docs/adr/0004-open-core-licensing.md).

export const EditionNameSchema = z.enum(["community", "business"]);
export type EditionName = z.infer<typeof EditionNameSchema>;

/**
 * Outcome of the offline licence key check. `absent` means no key is
 * configured; every status other than `valid` runs as Community.
 */
export const LicenseStatusSchema = z.enum([
  "absent",
  "valid",
  "expired",
  "invalid",
]);
export type LicenseStatus = z.infer<typeof LicenseStatusSchema>;

/** Business features a licence can grant. Unknown names in a key are ignored. */
export const BusinessFeatureSchema = z.enum(["sso"]);
export type BusinessFeature = z.infer<typeof BusinessFeatureSchema>;

/** Response of `GET /v1/edition`. Licensee and expiry are admin-only. */
export const EditionResponseSchema = z.object({
  edition: EditionNameSchema,
  licenseStatus: LicenseStatusSchema,
  features: z.array(BusinessFeatureSchema),
  licensee: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});
export type EditionResponse = z.infer<typeof EditionResponseSchema>;

/** Licence state resolved at boot; same shape as the edition response. */
export type LicenseState = EditionResponse;

/** problem+json `code` of a Business route without a valid licence (LIC-003). */
export const LICENSE_REQUIRED_CODE = "LICENSE_REQUIRED";
