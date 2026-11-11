import type { z } from "zod";
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
