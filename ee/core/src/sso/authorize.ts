import type { Hono } from "hono";
import {
  SsoAuthorizeRequestSchema,
  createProblemDetails,
} from "@librehr/contracts";
import { IdentityRepository } from "@librehr/db";
import type { EeExtensionContext } from "../extension.js";
import type { OidcDiscovery } from "./discovery.js";
import {
  buildOidcAuthorizationUrl,
  createLoginSecrets,
  isAllowedEmailDomain,
} from "./oidc.js";
import { setStateCookie } from "./state-cookie.js";

/** What the sign-in routes share; built once in routes.ts. */
export interface SsoSignInDeps {
  context: EeExtensionContext;
  discovery: OidcDiscovery;
  /** BETTER_AUTH_URL + /v1/sso/callback, never the request Host header. */
  redirectUri: string;
}

/** Per client IP, on the API's shared store (holds across replicas). */
export const SSO_SIGN_IN_RATE_LIMIT = { windowMs: 60_000, max: 30 };

/**
 * POST /v1/sso/authorize: finds the organization's provider for an email
 * domain and starts an authorization-code flow with PKCE (S256) and a
 * nonce. State, nonce and verifier are stored server-side for one use; the
 * browser only gets the state, in an HttpOnly cookie for the callback.
 */
export function registerAuthorizeRoute(
  router: Hono,
  deps: SsoSignInDeps,
): void {
  const { context, discovery, redirectUri } = deps;
  const identityRepo = new IdentityRepository();

  router.post(
    "/authorize",
    context.rateLimit("sso.authorize", SSO_SIGN_IN_RATE_LIMIT),
    async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const parsed = SsoAuthorizeRequestSchema.safeParse(body);

      if (!parsed.success) {
        return c.json(
          createProblemDetails({
            status: 400,
            title: "Validation Error",
            detail: "Invalid SSO authorize request",
            code: "VALIDATION_ERROR",
          }),
          400,
          { "Content-Type": "application/problem+json" },
        );
      }

      const email = parsed.data.email;
      const domain =
        parsed.data.domain ?? (email ? email.split("@")[1] : undefined);

      if (!domain) {
        return c.json(
          createProblemDetails({
            status: 400,
            title: "Missing Domain",
            detail:
              "Email or company domain is required to discover SSO provider",
            code: "MISSING_DOMAIN",
          }),
          400,
          { "Content-Type": "application/problem+json" },
        );
      }

      // Discovery runs before any tenant context: the identity lookup returns
      // only the matching enabled configuration, never the client secret.
      const config = await identityRepo.ssoConfigForDomain(context.sql, domain);
      const match =
        config && isAllowedEmailDomain(`user@${domain}`, config.allowedDomains)
          ? config
          : null;

      if (!match) {
        return c.json(
          createProblemDetails({
            status: 404,
            title: "SSO Not Configured",
            detail: `No active SSO configuration found for domain '${domain}'`,
            code: "SSO_NOT_FOUND",
          }),
          404,
          { "Content-Type": "application/problem+json" },
        );
      }

      const provider = await discovery.discover(match.issuerUrl).catch(() => {
        throw context.createError({
          status: 502,
          title: "Bad Gateway",
          code: "SSO_UNAVAILABLE",
          detail: "The identity provider could not be reached",
        });
      });

      const secrets = createLoginSecrets();
      await identityRepo.ssoBeginLogin(context.sql, {
        state: secrets.state,
        organizationId: match.organizationId,
        ssoConfigurationId: match.id,
        issuerUrl: match.issuerUrl,
        clientId: match.clientId,
        nonce: secrets.nonce,
        codeVerifier: secrets.codeVerifier,
        locale: parsed.data.locale ?? "ca",
      });
      setStateCookie(c, secrets.state, redirectUri);

      return c.json({
        authorizationUrl: buildOidcAuthorizationUrl({
          authorizationEndpoint: provider.authorizationEndpoint,
          clientId: match.clientId,
          redirectUri,
          state: secrets.state,
          nonce: secrets.nonce,
          codeChallenge: secrets.codeChallenge,
        }),
      });
    },
  );
}
