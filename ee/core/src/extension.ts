import type { Hono, MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import type { BusinessFeature } from "@librehr/contracts";

/** A client-safe RFC 9457 problem the API's error handler serializes. */
export interface ProblemInit {
  status: number;
  title: string;
  code: string;
  detail?: string | undefined;
  errors?: { field: string; message: string }[] | undefined;
}

/**
 * What the API hands a Business extension. Mirrors `ExtensionContext` in
 * apps/api/src/extensions/types.ts; `ee/` cannot import the API, and the
 * API's type check of `createEeExtensions` keeps both in sync.
 */
export interface EeExtensionContext {
  sql: Sql;
  requireAuth: MiddlewareHandler;
  publicApiUrl: string;
  ssoEnabled: boolean;
  /** Builds the API's AppError, so thrown problems map to problem+json. */
  createError: (init: ProblemInit) => Error;
}

/** Routes of one Business feature, mounted by the API under `/v1`. */
export interface EeApiExtension {
  feature: BusinessFeature;
  register: (router: Hono, context: EeExtensionContext) => void;
}
