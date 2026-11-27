import crypto from "node:crypto";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { SsoErrorCode } from "@librehr/contracts";
import {
  AuditRepository,
  IdentityRepository,
  withTenant,
  type SsoConsumeResult,
  type SsoLocale,
  type SsoResolveOutcome,
} from "@librehr/db";
import type { EeSignInResult } from "../extension.js";
import { SSO_SIGN_IN_RATE_LIMIT, type SsoSignInDeps } from "./authorize.js";
import { OidcError, type OidcFailureReason } from "./errors.js";
import { verifyIdToken } from "./id-token.js";
import { exchangeAuthorizationCode } from "./oidc.js";
import { takeStateCookie } from "./state-cookie.js";

const CallbackQuerySchema = z.object({
  state: z.string().min(1).max(512).optional(),
  code: z.string().min(1).max(4096).optional(),
  // The provider's error text is never read or echoed back.
  error: z.string().optional(),
});

const OIDC_ERROR_CODES: Record<OidcFailureReason, SsoErrorCode> = {
  issuer_not_supported: "SSO_UNAVAILABLE",
  discovery_failed: "SSO_UNAVAILABLE",
  exchange_failed: "SSO_EXCHANGE_FAILED",
  token_invalid: "SSO_TOKEN_INVALID",
  email_not_verified: "SSO_EMAIL_NOT_VERIFIED",
  domain_not_allowed: "SSO_DOMAIN_NOT_ALLOWED",
};

const RESOLVE_ERROR_CODES: Record<
  Exclude<SsoResolveOutcome, "ok">,
  SsoErrorCode
> = {
  expired: "SSO_EXPIRED",
  invalid: "SSO_TOKEN_INVALID",
  unavailable: "SSO_UNAVAILABLE",
  domain_not_allowed: "SSO_DOMAIN_NOT_ALLOWED",
  no_account: "SSO_NO_ACCOUNT",
  identity_conflict: "SSO_IDENTITY_CONFLICT",
  multi_org_account: "SSO_MULTI_ORG_ACCOUNT",
};

type ConsumedRequest = Extract<SsoConsumeResult, { outcome: "ok" }>;

/** Where the browser goes next, or why the sign-in was refused. */
type CallbackOutcome =
  | { ok: true; userId: string; result: EeSignInResult }
  | { ok: false; code: SsoErrorCode };

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * GET /v1/sso/callback (AUTH-004), the redirect URI. Always answers with a
 * 302 to the web app: the browser arrives here by navigation, never fetch.
 */
export function registerCallbackRoute(router: Hono, deps: SsoSignInDeps): void {
  const { context, redirectUri } = deps;
  const identityRepo = new IdentityRepository();
  const auditRepo = new AuditRepository();

  const webUrl = (locale: SsoLocale, path: string) =>
    // Without APP_URL the web app is assumed to share the API's origin.
    `${(context.appUrl ?? "").replace(/\/$/, "")}/${locale}/${path}`;

  // Refusals are audited once the organization is known from the state;
  // metadata holds a reason code and the provider only, never email or sub.
  const auditFailure = (
    organizationId: string,
    code: SsoErrorCode,
    request?: ConsumedRequest,
  ) =>
    withTenant(context.sql, { organizationId }, (tx) =>
      auditRepo.log(tx, {
        actorId: null,
        action: "auth.sso.sign_in_failed",
        resourceType: "sso_configurations",
        resourceId: request?.ssoConfigurationId ?? null,
        metadata: {
          reason: code.slice("SSO_".length).toLowerCase(),
          ...(request ? { provider: request.provider } : {}),
        },
      }),
    );

  router.get(
    "/callback",
    context.rateLimit("sso.callback", SSO_SIGN_IN_RATE_LIMIT),
    async (c) => {
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      const fail = (locale: SsoLocale, code: SsoErrorCode) =>
        c.redirect(webUrl(locale, `sign-in?sso_error=${code}`), 302);

      const { state: cookieState, locale: cookieLocale } = takeStateCookie(
        c,
        redirectUri,
      );
      const query = CallbackQuerySchema.safeParse(c.req.query());
      const state = query.success ? query.data.state : undefined;
      // Checked before the request is spent, so a forged callback opened in
      // someone else's browser cannot burn or finish a sign-in.
      if (!query.success || !state || !cookieState) {
        return fail(cookieLocale, "SSO_STATE_INVALID");
      }
      if (!safeEqual(state, cookieState)) {
        return fail(cookieLocale, "SSO_STATE_INVALID");
      }

      const request = await identityRepo.ssoConsume(context.sql, state);
      if (request.outcome === "invalid") {
        return fail(cookieLocale, "SSO_STATE_INVALID");
      }
      if (request.outcome !== "ok") {
        const code =
          request.outcome === "expired" ? "SSO_EXPIRED" : "SSO_UNAVAILABLE";
        await auditFailure(request.organizationId, code);
        return fail(request.locale, code);
      }

      const outcome = await finishSignIn(c, deps, identityRepo, {
        request,
        state,
        code: query.data.error === undefined ? query.data.code : undefined,
      });
      if (!outcome.ok) {
        await auditFailure(request.organizationId, outcome.code, request);
        return fail(request.locale, outcome.code);
      }

      const { result } = outcome;
      if (result.outcome === "no_membership") {
        await auditFailure(request.organizationId, "SSO_NO_ACCOUNT", request);
        return fail(request.locale, "SSO_NO_ACCOUNT");
      }
      if (result.outcome === "two_factor_unavailable") {
        await auditFailure(request.organizationId, "SSO_UNAVAILABLE", request);
        return fail(request.locale, "SSO_UNAVAILABLE");
      }
      await withTenant(
        context.sql,
        { organizationId: request.organizationId, userId: outcome.userId },
        (tx) =>
          auditRepo.log(tx, {
            actorId: outcome.userId,
            action: "auth.sso.sign_in",
            resourceType: "sso_configurations",
            resourceId: request.ssoConfigurationId,
            metadata: {
              provider: request.provider,
              step: result.outcome === "signed_in" ? "session" : "two_factor",
            },
          }),
      );
      if (result.outcome === "two_factor_required") {
        // A fragment is neither sent to a server nor in a Referer header.
        return c.redirect(
          webUrl(
            request.locale,
            `sign-in#sso_challenge=${encodeURIComponent(result.challengeToken)}`,
          ),
          302,
        );
      }
      return c.redirect(webUrl(request.locale, "sso/complete"), 302);
    },
  );
}

/**
 * Code exchange, id_token verification and user resolution for a spent
 * request. OIDC refusals become error codes; anything else (database
 * failures) propagates as a 500.
 */
async function finishSignIn(
  c: Context,
  deps: SsoSignInDeps,
  identityRepo: IdentityRepository,
  input: { request: ConsumedRequest; state: string; code: string | undefined },
): Promise<CallbackOutcome> {
  const { context, discovery, redirectUri } = deps;
  const { request, state, code } = input;
  if (code === undefined) return { ok: false, code: "SSO_PROVIDER_ERROR" };

  let identity: Awaited<ReturnType<typeof verifyIdToken>>;
  try {
    const provider = await discovery.discover(request.issuerUrl);
    const idToken = await exchangeAuthorizationCode(context.oidcHttp, {
      provider,
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      code,
      redirectUri,
      codeVerifier: request.codeVerifier,
    });
    identity = await verifyIdToken(
      idToken,
      {
        provider,
        clientId: request.clientId,
        nonce: request.nonce,
        allowedDomains: request.allowedDomains,
      },
      (refresh) => discovery.keys(provider.jwksUri, refresh),
    );
  } catch (error) {
    if (error instanceof OidcError) {
      return { ok: false, code: OIDC_ERROR_CODES[error.reason] };
    }
    throw error;
  }

  // The link is keyed on the configured issuer (the request's snapshot).
  const resolved = await identityRepo.ssoResolveUser(context.sql, {
    state,
    issuer: request.issuerUrl,
    subject: identity.subject,
    email: identity.email,
  });
  if (resolved.outcome !== "ok") {
    return { ok: false, code: RESOLVE_ERROR_CODES[resolved.outcome] };
  }
  // createSession re-checks the membership in this organization (EMP-007).
  const result = await context.completeSignIn(c, {
    userId: resolved.userId,
    organizationId: request.organizationId,
  });
  return { ok: true, userId: resolved.userId, result };
}
