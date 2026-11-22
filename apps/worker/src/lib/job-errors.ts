import type { ZodError } from "zod";

/**
 * Base class for errors a job handler raises on purpose. Their messages are written by us and
 * must never contain payload values (emails, names, tokens), so they are safe to log and to
 * store as the pg-boss job output. Any other error is treated as opaque.
 */
export abstract class JobError extends Error {
  /** false: retrying cannot help, so the job is dead-lettered (terminal failure). */
  abstract readonly retryable: boolean;
  override readonly name: string = this.constructor.name;
}

export class InvalidPayloadError extends JobError {
  readonly retryable = false;
  constructor(queue: string, error: ZodError) {
    // Paths and issue codes only: Zod messages can echo the received value.
    const issues = error.issues
      .map((i) => `${i.path.join(".") || "(root)"}:${i.code}`)
      .join(", ");
    super(`invalid ${queue} payload: ${issues}`);
  }
}

export class MissingPolicyError extends JobError {
  readonly retryable = false;
  constructor(field: string) {
    super(`missing policy configuration: ${field}`);
  }
}

/** Stored employee data a job needs is unusable; fixing the data, not a retry, helps. */
export class InvalidEmploymentDataError extends JobError {
  readonly retryable = false;
  constructor(field: string, employeeIds: readonly string[]) {
    // Ids only, and at most ten, so the message stays bounded.
    const shown = employeeIds.slice(0, 10).join(", ");
    const more =
      employeeIds.length > 10 ? ` and ${employeeIds.length - 10} more` : "";
    super(`invalid ${field} for employees ${shown}${more}`);
  }
}

export class NotImplementedError extends JobError {
  readonly retryable = false;
  constructor(what: string) {
    super(`not implemented: ${what}`);
  }
}

/** Retryable: once an operator configures SMTP, pending retries will succeed. */
export class SmtpNotConfiguredError extends JobError {
  readonly retryable = true;
  constructor() {
    super("SMTP is not configured (set SMTP_HOST); email was not sent");
  }
}
