import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import type { BusinessFeature, LicenseState } from "@librehr/contracts";
import type { AppErrorInit } from "../errors/index.js";
import type { CompleteSignIn } from "../lib/complete-sign-in.js";
import type { OidcHttpClient } from "../lib/oidc-http.js";

export type {
  CompleteSignIn,
  SignInResult,
  SignInSubject,
} from "../lib/complete-sign-in.js";
export type {
  OidcHttpClient,
  OidcHttpRequest,
  OidcHttpResponse,
} from "../lib/oidc-http.js";

/** A rate limit an extension asks for; buckets live in the shared store. */
export interface ExtensionRateLimit {
  windowMs: number;
  max: number;
  /** Adds an account key (hashed) to the per-IP bucket; null for none. */
  account?:
    ((c: Context) => Promise<string | null> | string | null) | undefined;
}

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
  /** Builds an AppError, so problems thrown by extensions map to problem+json. */
  createError: (init: AppErrorInit) => Error;
  /** Public web app URL (APP_URL) for redirects after sign-in, if set. */
  appUrl: string | undefined;
  /**
   * A 429 middleware on the shared rate-limit store, so limits hold across
   * API replicas. `name` is namespaced under `ext.`, so an extension cannot
   * share or reset a core limiter's bucket.
   */
  rateLimit: (name: string, limit: ExtensionRateLimit) => MiddlewareHandler;
  /** SSRF-guarded HTTP to identity providers (lib/oidc-http.ts). */
  oidcHttp: OidcHttpClient;
  /** Opens a session for a verified user, or asks for local 2FA first. */
  completeSignIn: CompleteSignIn;
}

/** Routes of one Business feature, mounted under its own `/v1` prefix. */
export interface ApiExtension {
  feature: BusinessFeature;
  register: (router: Hono, context: ExtensionContext) => void;
}

/** Licence state plus the extensions it unlocks. */
export interface EditionBundle {
  license: LicenseState;
  extensions: ApiExtension[];
}
