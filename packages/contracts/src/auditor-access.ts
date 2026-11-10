import { z } from "zod";

/**
 * TIM-008: time-boxed inspector/auditor access. An admin lists the
 * organization's auditors, moves an auditor's access end date (within the
 * organization's `auditorAccessMaxDays`) or revokes access immediately.
 */

/** Bounds of `organizations.auditor_access_max_days` (migration 0029). */
export const AUDITOR_ACCESS_MAX_DAYS_MIN = 1;
export const AUDITOR_ACCESS_MAX_DAYS_MAX = 366;
export const AUDITOR_ACCESS_MAX_DAYS_DEFAULT = 90;

export const AuditorAccessMaxDaysSchema = z
  .number()
  .int()
  .min(AUDITOR_ACCESS_MAX_DAYS_MIN)
  .max(AUDITOR_ACCESS_MAX_DAYS_MAX);

export const AuditorSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  /** Null only for an auditor created outside the API with no end date. */
  accessExpiresAt: z.string().datetime().nullable(),
});
export type Auditor = z.infer<typeof AuditorSchema>;

export const AuditorListResponseSchema = z.object({
  items: z.array(AuditorSchema),
});
export type AuditorListResponse = z.infer<typeof AuditorListResponseSchema>;

/** Either a new end date (extend or shorten) or an immediate revocation. */
export const UpdateAuditorAccessRequestSchema = z.union([
  z.object({ accessExpiresAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ revoke: z.literal(true) }).strict(),
]);
export type UpdateAuditorAccessRequest = z.infer<
  typeof UpdateAuditorAccessRequestSchema
>;

/**
 * Stable `code` values of the 400 problems returned when an access end date
 * is outside the allowed window, so clients can show a translated message.
 */
export const AUDITOR_ACCESS_ERROR_CODES = {
  inPast: "AUDITOR_ACCESS_END_IN_PAST",
  tooFar: "AUDITOR_ACCESS_END_TOO_FAR",
} as const;
