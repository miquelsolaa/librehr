import { AUDITOR_ACCESS_ERROR_CODES } from "@librehr/contracts";
import {
  addDays,
  auditorAccessEndInstant,
  checkAuditorAccessUntil,
  dateInZone,
} from "@librehr/core";
import type { AuditorAccessWindow } from "@librehr/db";
import { ValidationError } from "../errors/index.js";

/** Today and the latest allowed last day, in the organization's zone. */
export function auditorAccessBounds(window: AuditorAccessWindow): {
  today: string;
  latestAccessUntil: string;
} {
  const today = dateInZone(window.now, window.timeZone);
  return { today, latestAccessUntil: addDays(today, window.maxDays) };
}

/**
 * TIM-008: turns a requested last day of access (organization time zone)
 * into the instant access ends, after checking it is today or later and at
 * most `maxDays` days after today. "Today" comes from the database clock
 * (`AuditorAccessRepository.window`), the clock the membership lookup
 * compares against. Throws a 400 ValidationError with a stable code.
 *
 * @example
 * const end = resolveAuditorAccessEnd(body.accessUntil, await repo.window(tx));
 */
export function resolveAuditorAccessEnd(
  accessUntil: string,
  window: AuditorAccessWindow,
): Date {
  const { today } = auditorAccessBounds(window);
  const problem = checkAuditorAccessUntil(accessUntil, today, window.maxDays);
  if (problem === "in_past") {
    throw new ValidationError({
      code: AUDITOR_ACCESS_ERROR_CODES.inPast,
      detail: "The last day of access cannot be before today",
      issues: [{ field: "accessUntil", message: "Must be today or later" }],
    });
  }
  if (problem === "too_far") {
    throw new ValidationError({
      code: AUDITOR_ACCESS_ERROR_CODES.tooFar,
      detail: `The last day of access can be at most ${window.maxDays} days ahead`,
      issues: [
        {
          field: "accessUntil",
          message: `At most ${window.maxDays} days ahead`,
        },
      ],
    });
  }
  return new Date(auditorAccessEndInstant(accessUntil, window.timeZone));
}
