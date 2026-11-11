import { z } from "zod";

/**
 * TIM-008: time-boxed inspector/auditor access. Access is granted until a
 * calendar day (`accessUntil`, `YYYY-MM-DD`) in the organization's time zone
 * and ends at the local midnight after it. An admin lists the
 * organization's auditors and pending auditor invitations, moves an
 * auditor's last day (within `auditorAccessMaxDays` days from today),
 * revokes access immediately or cancels a pending invitation.
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

/** A real calendar date `YYYY-MM-DD` (rejects e.g. 2026-02-30). */
export const AccessUntilSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Not a valid calendar date");

export const AuditorSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  /** Instant access ends (exclusive). */
  accessExpiresAt: z.string().datetime(),
  /** Last day of access in the organization's time zone. */
  accessUntil: z.string(),
});
export type Auditor = z.infer<typeof AuditorSchema>;

export const PendingAuditorInvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  accessExpiresAt: z.string().datetime(),
  accessUntil: z.string(),
  /** When the invitation link stops working. */
  expiresAt: z.string().datetime(),
});
export type PendingAuditorInvitation = z.infer<
  typeof PendingAuditorInvitationSchema
>;

export const AuditorListResponseSchema = z.object({
  items: z.array(AuditorSchema),
  pendingInvitations: z.array(PendingAuditorInvitationSchema),
  /** The organization's time zone, in which `accessUntil` days are read. */
  timeZone: z.string(),
  /** Today in the organization's time zone (database clock). */
  today: z.string(),
  /** Latest `accessUntil` currently allowed (today + auditorAccessMaxDays). */
  latestAccessUntil: z.string(),
  auditorAccessMaxDays: AuditorAccessMaxDaysSchema,
});
export type AuditorListResponse = z.infer<typeof AuditorListResponseSchema>;

/** Either a new last day of access (extend or shorten) or a revocation. */
export const UpdateAuditorAccessRequestSchema = z.union([
  z.object({ accessUntil: AccessUntilSchema }).strict(),
  z.object({ revoke: z.literal(true) }).strict(),
]);
export type UpdateAuditorAccessRequest = z.infer<
  typeof UpdateAuditorAccessRequestSchema
>;

/**
 * Stable `code` values of the problems about auditor access, so clients can
 * show a translated message.
 */
export const AUDITOR_ACCESS_ERROR_CODES = {
  inPast: "AUDITOR_ACCESS_END_IN_PAST",
  tooFar: "AUDITOR_ACCESS_END_TOO_FAR",
  /** GET /v1/invitations/:token for an auditor invite whose access ended. */
  invitationAccessExpired: "INVITATION_ACCESS_EXPIRED",
} as const;
