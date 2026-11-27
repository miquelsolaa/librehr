import { z } from "zod";
import type { EeExtensionContext } from "../extension.js";
import { OidcError } from "./errors.js";

export type OidcHttp = EeExtensionContext["oidcHttp"];

const MICROSOFT_HOST = "login.microsoftonline.com";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Discovery documents and key sets are cached per process for one hour. */
export const DISCOVERY_TTL_MS = 60 * 60 * 1000;
/** A forced JWKS refetch (unknown `kid`) happens at most once a minute. */
export const JWKS_REFRESH_MIN_MS = 60 * 1000;

const HttpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "https required");

const DiscoveryDocumentSchema = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: HttpsUrl,
  token_endpoint: HttpsUrl,
  jwks_uri: HttpsUrl,
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
});

const JwksSchema = z.object({
  keys: z.array(z.record(z.string(), z.unknown())),
});

/** What the callback needs from a provider's discovery document. */
export interface OidcProviderMetadata {
  /** The issuer exactly as the provider states it (checked against `iss`). */
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** client_secret_post only when the provider does not offer basic. */
  tokenAuthMethod: "client_secret_basic" | "client_secret_post";
  /** Entra tenant id for Microsoft issuers; the id_token `tid` must match. */
  microsoftTenantId: string | null;
}

/** Removes trailing slashes in linear time (see trimTrailing in oidc.ts). */
function trimSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/**
 * Refuses issuers the callback cannot verify safely: anything but https,
 * and Microsoft's multi-tenant endpoints (`/common`, `/organizations`,
 * `/consumers`), whose `email` claims come from any Entra tenant unverified.
 * Returns the Entra tenant id for Microsoft issuers, null otherwise.
 *
 * @example assertSupportedIssuer("https://accounts.google.com") // null
 */
export function assertSupportedIssuer(issuerUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(issuerUrl);
  } catch {
    throw new OidcError("issuer_not_supported");
  }
  if (url.protocol !== "https:" || url.search || url.hash) {
    throw new OidcError("issuer_not_supported");
  }
  if (url.hostname !== MICROSOFT_HOST) return null;
  const [tenant, version, ...rest] = trimSlashes(url.pathname)
    .split("/")
    .slice(1);
  if (!tenant || !GUID.test(tenant) || version !== "v2.0" || rest.length) {
    throw new OidcError("issuer_not_supported");
  }
  return tenant.toLowerCase();
}

/**
 * Validates a discovery document against the configured issuer. The stated
 * issuer must equal the configured one (trailing slashes aside), so a
 * document cannot redirect verification to another issuer.
 */
export function parseDiscoveryDocument(
  json: unknown,
  configuredIssuer: string,
): OidcProviderMetadata {
  const microsoftTenantId = assertSupportedIssuer(configuredIssuer);
  const parsed = DiscoveryDocumentSchema.safeParse(json);
  if (!parsed.success) throw new OidcError("discovery_failed");
  const doc = parsed.data;
  if (trimSlashes(doc.issuer) !== trimSlashes(configuredIssuer)) {
    throw new OidcError("discovery_failed");
  }
  const methods = doc.token_endpoint_auth_methods_supported;
  const postOnly =
    methods !== undefined &&
    !methods.includes("client_secret_basic") &&
    methods.includes("client_secret_post");
  return {
    issuer: doc.issuer,
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
    tokenAuthMethod: postOnly ? "client_secret_post" : "client_secret_basic",
    microsoftTenantId,
  };
}

/** A JSON Web Key Set as returned by the provider's `jwks_uri`. */
export interface JsonWebKeySet {
  keys: Record<string, unknown>[];
}

export interface OidcDiscovery {
  discover: (issuerUrl: string) => Promise<OidcProviderMetadata>;
  /**
   * `refresh` refetches a set older than a minute, for a key rotated since
   * the last fetch.
   */
  keys: (jwksUri: string, refresh?: boolean) => Promise<JsonWebKeySet>;
}

/**
 * Discovery and JWKS through the SSRF-guarded client, cached per process.
 * Any transport failure or non-200 answer is `discovery_failed`.
 */
export function createOidcDiscovery(
  http: OidcHttp,
  options: { now?: () => number; ttlMs?: number } = {},
): OidcDiscovery {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DISCOVERY_TTL_MS;
  const documents = new Map<
    string,
    { at: number; value: OidcProviderMetadata }
  >();
  const keySets = new Map<string, { at: number; value: JsonWebKeySet }>();

  async function getJson(url: string): Promise<unknown> {
    try {
      const response = await http({ method: "GET", url });
      if (response.status !== 200) throw new OidcError("discovery_failed");
      return response.json;
    } catch {
      throw new OidcError("discovery_failed");
    }
  }

  return {
    async discover(issuerUrl) {
      const cached = documents.get(issuerUrl);
      if (cached && now() - cached.at < ttlMs) return cached.value;
      assertSupportedIssuer(issuerUrl);
      const url = `${trimSlashes(issuerUrl)}/.well-known/openid-configuration`;
      const value = parseDiscoveryDocument(await getJson(url), issuerUrl);
      documents.set(issuerUrl, { at: now(), value });
      return value;
    },
    async keys(jwksUri, refresh = false) {
      const cached = keySets.get(jwksUri);
      // Tokens with made-up key ids must not turn into one fetch each.
      const maxAge = refresh ? JWKS_REFRESH_MIN_MS : ttlMs;
      if (cached && now() - cached.at < maxAge) return cached.value;
      const parsed = JwksSchema.safeParse(await getJson(jwksUri));
      if (!parsed.success) throw new OidcError("discovery_failed");
      keySets.set(jwksUri, { at: now(), value: parsed.data });
      return parsed.data;
    },
  };
}
