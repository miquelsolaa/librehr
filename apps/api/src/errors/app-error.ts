export interface FieldIssue {
  field: string;
  message: string;
}

export interface AppErrorOptions {
  /** Human-readable explanation. Must be safe to show to clients: no PII, ids or internals. */
  detail?: string | undefined;
  /** Stable machine-readable code (e.g. `NOT_FOUND`). */
  code?: string | undefined;
}

export interface AppErrorInit extends AppErrorOptions {
  status: number;
  title: string;
  code: string;
  type?: string | undefined;
  errors?: FieldIssue[] | undefined;
}

/**
 * Base class for expected, client-facing errors. Every field on an AppError is
 * serialized into an RFC 9457 problem document by the error handler, so only
 * values that are safe to expose may be put here.
 */
export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly code: string;
  readonly detail: string | undefined;
  readonly errors: FieldIssue[] | undefined;

  constructor(init: AppErrorInit) {
    super(init.detail ?? init.title);
    this.name = new.target.name;
    this.status = init.status;
    this.type = init.type ?? "about:blank";
    this.title = init.title;
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors;
  }
}
