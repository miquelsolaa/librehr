import type { ZodError } from "zod";
import {
  SSO_BREAK_GLASS_REQUIRED_CODE,
  SSO_REQUIRED_CODE,
} from "@librehr/contracts";
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
 * AUTH-004: a password session was refused because the organization requires
 * single sign-on. Raised only after the password (and second factor)
 * verified, and it names no organization.
 */
export class SsoRequiredError extends ForbiddenError {
  constructor() {
    super({
      code: SSO_REQUIRED_CODE,
      detail: "This organization requires single sign-on",
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

/**
 * AUTH-004: the change would leave an organization that requires SSO without
 * a break-glass admin (an active admin with two-factor authentication), so
 * nobody could sign in with a password if the identity provider fails.
 */
export class SsoBreakGlassRequiredError extends ConflictError {
  constructor() {
    super({
      code: SSO_BREAK_GLASS_REQUIRED_CODE,
      detail:
        "An organization that requires single sign-on needs at least one administrator with two-factor authentication",
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
