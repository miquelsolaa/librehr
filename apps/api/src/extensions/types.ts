import type { Hono, MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import type { BusinessFeature, LicenseState } from "@librehr/contracts";
import type { AppErrorInit } from "../errors/index.js";

/**
 * What the API hands a Business extension when mounting it (ADR 0004).
 * Extensions in `ee/` cannot import the API, so everything they need from it
 * is passed here.
 */
export interface ExtensionContext {
  sql: Sql;
  /** The API's 401 guard (problem+json). */
  requireAuth: MiddlewareHandler;
  /** Public API base URL (BETTER_AUTH_URL), never the request Host header. */
  publicApiUrl: string;
  /** SSO_ENABLED. */
  ssoEnabled: boolean;
  /** Builds an AppError, so problems thrown by extensions map to problem+json. */
  createError: (init: AppErrorInit) => Error;
}

/** Routes of one Business feature, mounted under `/v1`. */
export interface ApiExtension {
  feature: BusinessFeature;
  register: (router: Hono, context: ExtensionContext) => void;
}

/** Licence state plus the extensions it unlocks. */
export interface EditionBundle {
  license: LicenseState;
  extensions: ApiExtension[];
}
