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
