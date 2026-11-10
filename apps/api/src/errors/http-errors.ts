import type { ZodError } from "zod";
import {
  AppError,
  type AppErrorOptions,
  type FieldIssue,
} from "./app-error.js";

export class NotFoundError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super({
      status: 404,
      title: "Not Found",
      code: options.code ?? "NOT_FOUND",
      detail: options.detail ?? "Resource not found",
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super({
      status: 401,
      title: "Unauthorized",
      code: options.code ?? "UNAUTHORIZED",
      detail: options.detail ?? "Authentication is required",
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super({
      status: 403,
      title: "Forbidden",
      code: options.code ?? "FORBIDDEN",
      detail: options.detail ?? "You do not have permission to do this",
    });
  }
}

/**
 * LEA-004 / TIM-003: the caller tried to decide their own request. Distinct
 * from a plain 403 so clients can explain that someone else must decide.
 */
export class SelfApprovalForbiddenError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super({
      status: 403,
      type: "urn:librehr:problem:self-approval-forbidden",
      title: "Forbidden",
      code: options.code ?? "SELF_APPROVAL_FORBIDDEN",
      detail:
        options.detail ??
        "You cannot approve or reject your own request; another approver must decide it",
    });
  }
}

/**
 * LIC-003: a Business edition feature without a valid licence. Distinct from
 * a plain 403 so the UI can explain that the feature needs LibreHR Business.
 */
export class LicenseRequiredError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super({
      status: 403,
      type: "urn:librehr:problem:license-required",
      title: "Forbidden",
      code: options.code ?? "LICENSE_REQUIRED",
      detail:
        options.detail ??
        "This feature is part of LibreHR Business and needs a valid licence",
    });
  }
}

export class ConflictError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super({
      status: 409,
      title: "Conflict",
      code: options.code ?? "CONFLICT",
      detail: options.detail ?? "The request conflicts with the current state",
    });
  }
}

export interface ValidationErrorOptions extends AppErrorOptions {
  /** 400 for malformed input (default), 422 where a route already uses it. */
  status?: 400 | 422 | undefined;
  issues?: FieldIssue[] | undefined;
}

export class ValidationError extends AppError {
  constructor(options: ValidationErrorOptions = {}) {
    super({
      status: options.status ?? 400,
      title: "Validation Error",
      code: options.code ?? "VALIDATION_ERROR",
      detail: options.detail ?? "Request validation failed",
      errors: options.issues,
    });
  }

  /**
   * Builds a ValidationError from a ZodError, keeping only the field path and
   * message of each issue (never the received value or schema internals).
   */
  static fromZod(
    error: ZodError,
    options: Omit<ValidationErrorOptions, "issues"> = {},
  ): ValidationError {
    const issues = error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    return new ValidationError({
      ...options,
      detail: options.detail ?? issues[0]?.message,
      issues,
    });
  }
}
