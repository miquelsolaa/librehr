import { AppError } from "../errors/index.js";

/** SQLSTATEs the API turns into problem responses. */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_EXCLUSION_VIOLATION = "23P01";

/** SQLSTATE of a database driver error, if it is one. */
export function pgErrorCode(err: unknown): string | undefined {
  if (err instanceof AppError || typeof err !== "object" || err === null)
    return undefined;
  const code: unknown = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Runs `work` and turns the listed SQLSTATEs into typed errors. Used where a
 * constraint is the last guard against a race the route already pre-checks
 * (e.g. two concurrent inserts of overlapping memberships).
 */
export async function mapPgErrors<T>(
  work: () => Promise<T>,
  map: Readonly<Record<string, () => AppError>>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const toError = map[pgErrorCode(err) ?? ""];
    throw toError ? toError() : err;
  }
}
