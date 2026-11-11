import type { Context } from "hono";
import { z } from "zod";
import {
  NotFoundError,
  ValidationError,
  type ValidationErrorOptions,
} from "../errors/index.js";

type ParseOptions = Omit<ValidationErrorOptions, "issues">;

/** Path params for routes addressed by a single resource id. */
export const IdParamSchema = z.object({ id: z.string().uuid() });

/**
 * Reads and validates a JSON request body. Malformed JSON and schema failures
 * both become a 400 ValidationError (or the status given in `options`), so a
 * bad payload can never surface as a 500.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
  options: ParseOptions = {},
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ValidationError({
      status: 400,
      code: "MALFORMED_JSON",
      detail: "Request body must be valid JSON",
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error, options);
  return parsed.data;
}

/** Validates the query string. Use `z.coerce` for numeric values. */
export function parseQuery<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
  options: ParseOptions = {},
): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw ValidationError.fromZod(parsed.error, options);
  return parsed.data;
}

/**
 * Validates path params. A malformed id cannot match any resource, so it is a
 * 404 (the convention already used by employment-history), which also avoids
 * sending non-UUID text to a uuid column.
 */
export function parseParams<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
  options: { detail?: string; code?: string } = {},
): z.output<S> {
  const parsed = schema.safeParse(c.req.param());
  if (!parsed.success) throw new NotFoundError(options);
  return parsed.data;
}
