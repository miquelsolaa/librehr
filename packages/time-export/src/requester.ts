/**
 * Roles holding organization-wide `time.record.read`, the permission an
 * organization export needs (TIM-006). Mirrors ROLE_PERMISSIONS in
 * `@librehr/contracts`, which this package may not import; the API test
 * `time-export-roles.test.ts` asserts the two stay equal.
 */
export const ORG_WIDE_EXPORT_ROLES = ["admin", "auditor"] as const;

/**
 * Whether `role` may export the whole organization.
 *
 * @example
 * mayExportOrganization("auditor"); // => true
 * mayExportOrganization("manager"); // => false (reports scope only)
 */
export function mayExportOrganization(role: string): boolean {
  return (ORG_WIDE_EXPORT_ROLES as readonly string[]).includes(role);
}
