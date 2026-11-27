import { z } from "zod";
import { isValidIsoDate } from "@librehr/core";
import { InvalidPayloadError } from "./job-errors.js";

/** Validates a job payload at the queue boundary; throws a sanitized InvalidPayloadError. */
export function parsePayload<S extends z.ZodTypeAny>(
  queue: string,
  schema: S,
  data: unknown,
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new InvalidPayloadError(queue, result.error);
  return result.data;
}

export const isoDate = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * A real calendar day as `YYYY-MM-DD`. The regex alone lets 2027-02-30
 * through, which then throws a RangeError inside the handler and is retried
 * as a transient failure instead of being dead-lettered as a bad payload.
 */
export const isoDateString = () =>
  z
    .string()
    .regex(isoDate)
    .refine(isValidIsoDate, { message: "Not a calendar date" });
