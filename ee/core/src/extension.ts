import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import type { AuthUser, BusinessFeature } from "@librehr/contracts";

/** A client-safe RFC 9457 problem the API's error handler serializes. */
export interface ProblemInit {
  status: number;
  title: string;
  code: string;
  detail?: string | undefined;
  errors?: { field: string; message: string }[] | undefined;
}

/** Mirrors `OidcHttpRequest` / `OidcHttpResponse` in apps/api/src/lib/oidc-http.ts. */
export interface EeOidcHttpRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
}

export interface EeOidcHttpResponse {
  status: number;
  /** Parsed JSON body, or null when empty or not JSON. */
  json: unknown;
}

/** Mirrors `SignInResult` in apps/api/src/lib/complete-sign-in.ts. */
export type EeSignInResult =
  | { outcome: "signed_in"; user: AuthUser; expiresAt: Date }
  | { outcome: "two_factor_required"; challengeToken: string }
  | { outcome: "no_membership" }
  | { outcome: "two_factor_unavailable" };

/** Mirrors `ExtensionRateLimit` in apps/api/src/extensions/types.ts. */
export interface EeRateLimit {
  windowMs: number;
  max: number;
  account?:
    ((c: Context) => Promise<string | null> | string | null) | undefined;
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
  /** Builds the API's AppError, so thrown problems map to problem+json. */
  createError: (init: ProblemInit) => Error;
  /** Public web app URL (APP_URL), if set. */
  appUrl: string | undefined;
  /** 429 middleware on the shared store; names are namespaced by the API. */
  rateLimit: (name: string, limit: EeRateLimit) => MiddlewareHandler;
  /** SSRF-guarded HTTP to identity providers; rejects on refusal or timeout. */
  oidcHttp: (request: EeOidcHttpRequest) => Promise<EeOidcHttpResponse>;
  /** Opens a session in `organizationId`, or asks for local 2FA first. */
  completeSignIn: (
    c: Context,
    subject: { userId: string; organizationId: string },
  ) => Promise<EeSignInResult>;
}

/**
 * Routes of one Business feature. The API mounts the router under the
 * feature's own prefix (`/v1/sso` for `sso`), so paths here are relative.
 */
export interface EeApiExtension {
  feature: BusinessFeature;
  register: (router: Hono, context: EeExtensionContext) => void;
}
