import { AUDITOR_ACCESS_ERROR_CODES } from "@librehr/contracts";
import type { AuditorAccessWindow } from "@librehr/db";
import { ValidationError } from "../errors/index.js";

/**
 * TIM-008: an auditor's access end date must be in the future and no later
 * than the organization's maximum (`auditorAccessMaxDays` from now). Both
 * bounds come from the database clock (`AuditorAccessRepository.window`), the
 * clock the membership lookup compares against. Throws a 400 ValidationError
 * with a stable code otherwise.
 *
 * @example
 * const window = await auditorRepo.window(tx);
 * assertAuditorAccessEnd(new Date(body.accessExpiresAt), window);
 */
export function assertAuditorAccessEnd(
  requested: Date,
  window: AuditorAccessWindow,
): void {
  if (Number.isNaN(requested.getTime())) {
    throw new ValidationError({
      detail: "The access end date is not a valid date-time",
      issues: [{ field: "accessExpiresAt", message: "Invalid date-time" }],
    });
  }
  if (requested.getTime() <= window.now.getTime()) {
    throw new ValidationError({
      code: AUDITOR_ACCESS_ERROR_CODES.inPast,
      detail: "The access end date must be in the future",
      issues: [{ field: "accessExpiresAt", message: "Must be in the future" }],
    });
  }
  if (requested.getTime() > window.latest.getTime()) {
    throw new ValidationError({
      code: AUDITOR_ACCESS_ERROR_CODES.tooFar,
      detail: `The access end date can be at most ${window.maxDays} days ahead`,
      issues: [
        {
          field: "accessExpiresAt",
          message: `At most ${window.maxDays} days ahead`,
        },
      ],
    });
  }
}
