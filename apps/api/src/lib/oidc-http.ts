import { sendPinnedRequest, type OutboundSender } from "./outbound-request.js";
import {
  resolveOutboundTarget,
  type OutboundUrlPolicy,
} from "./outbound-url.js";

/** One request to an identity provider (discovery, JWKS, token endpoint). */
export interface OidcHttpRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string> | undefined;
  /** Form-encoded body for POST (token endpoint). */
  body?: string | undefined;
}

export interface OidcHttpResponse {
  status: number;
  /** The parsed JSON body, or null when the body is empty or not JSON. */
  json: unknown;
}

/**
 * SSRF-guarded HTTP for OIDC (AUTH-004). Rejects when the URL is refused by
 * the outbound guard (ValidationError OUTBOUND_URL_NOT_ALLOWED), the
 * provider does not answer in time, or the body is over the cap.
 */
export type OidcHttpClient = (
  request: OidcHttpRequest,
) => Promise<OidcHttpResponse>;

export const OIDC_TIMEOUT_MS = 10_000;
/** Discovery documents, JWKS and token responses are a few KB at most. */
export const OIDC_MAX_RESPONSE_BYTES = 256 * 1024;

export interface OidcHttpOptions extends OutboundUrlPolicy {
  /** Overrides the pinned sender (tests). */
  send?: OutboundSender | undefined;
  timeoutMs?: number | undefined;
  maxResponseBytes?: number | undefined;
}

/**
 * Builds the client handed to Business extensions. Every URL, including the
 * endpoints a discovery document names, goes through the same guard as
 * webhooks: https only, public addresses only, the socket pinned to the
 * checked addresses, no redirects followed, a time and size cap.
 */
export function createOidcHttpClient(options: OidcHttpOptions): OidcHttpClient {
  const send = options.send ?? sendPinnedRequest;
  const policy: OutboundUrlPolicy = {
    allowPrivate: options.allowPrivate,
    resolve: options.resolve,
  };
  return async (request) => {
    const target = await resolveOutboundTarget(request.url, policy);
    const response = await send(target, {
      method: request.method,
      headers: { Accept: "application/json", ...request.headers },
      body: request.method === "POST" ? (request.body ?? "") : undefined,
      timeoutMs: options.timeoutMs ?? OIDC_TIMEOUT_MS,
      maxResponseBytes: options.maxResponseBytes ?? OIDC_MAX_RESPONSE_BYTES,
    });
    return { status: response.status, json: parseJson(response.body) };
  };
}

function parseJson(body: string | undefined): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
