import { lookup } from "node:dns/promises";
import { ipVersion, isPublicIpAddress } from "@librehr/core";
import { ValidationError } from "../errors/index.js";

/** Resolves a hostname to every IP address it maps to. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export const systemHostResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((a) => a.address);
};

export interface OutboundUrlPolicy {
  /**
   * Development escape hatch (WEBHOOKS_ALLOW_PRIVATE, refused in production):
   * allows http:// and private or loopback hosts.
   */
  allowPrivate: boolean;
  resolve?: HostResolver | undefined;
}

function notAllowed(): ValidationError {
  // One generic message whatever the reason, so the endpoint cannot be used
  // to probe which internal names resolve.
  return new ValidationError({
    code: "OUTBOUND_URL_NOT_ALLOWED",
    detail: "The URL must be a public https:// address",
    issues: [
      { field: "url", message: "The URL must be a public https:// address" },
    ],
  });
}

/**
 * A URL that passed the guard together with the addresses its host resolved
 * to at check time. Connect only to these addresses (see
 * `sendPinnedRequest`): resolving the name again on connect would reopen a
 * DNS-rebinding window between the check and the request.
 */
export interface OutboundTarget {
  url: URL;
  /** Host without IPv6 brackets: a DNS name or an IP literal. */
  hostname: string;
  addresses: string[];
}

/**
 * Guards outbound requests against SSRF: the URL must be https and every
 * address its host resolves to must be publicly routable (no loopback,
 * private, CGNAT, link-local/metadata, unique-local or multicast, including
 * IPv4-mapped IPv6 forms). Call it when the URL is stored; use
 * {@link resolveOutboundTarget} right before each request so the connection
 * is pinned to the addresses that were checked.
 */
export async function assertPublicHttpsUrl(
  raw: string,
  policy: OutboundUrlPolicy,
): Promise<URL> {
  return (await checkOutboundUrl(raw, policy, false)).url;
}

/**
 * Resolves the host once and validates every address (unless the policy
 * allows private targets), returning them for the caller to pin the
 * connection to. Throws the same generic error as {@link assertPublicHttpsUrl}.
 */
export async function resolveOutboundTarget(
  raw: string,
  policy: OutboundUrlPolicy,
): Promise<OutboundTarget> {
  return checkOutboundUrl(raw, policy, true);
}

async function checkOutboundUrl(
  raw: string,
  policy: OutboundUrlPolicy,
  needAddresses: boolean,
): Promise<OutboundTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw notAllowed();
  }

  const allowed = policy.allowPrivate ? ["https:", "http:"] : ["https:"];
  if (!allowed.includes(url.protocol)) throw notAllowed();

  // WHATWG URL already normalises numeric hosts (0x7f.1, 2130706433) to
  // dotted IPv4 and keeps IPv6 literals in brackets.
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (ipVersion(hostname) !== 0) {
    if (!policy.allowPrivate && !isPublicIpAddress(hostname)) {
      throw notAllowed();
    }
    return { url, hostname, addresses: [hostname] };
  }

  // The development escape hatch skips the check when storing a URL; it
  // still resolves before sending so the connection is pinned all the same.
  if (policy.allowPrivate && !needAddresses) {
    return { url, hostname, addresses: [] };
  }

  let addresses: string[];
  try {
    addresses = await (policy.resolve ?? systemHostResolver)(hostname);
  } catch {
    throw notAllowed();
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => ipVersion(address) === 0) ||
    (!policy.allowPrivate &&
      !addresses.every((address) => isPublicIpAddress(address)))
  ) {
    throw notAllowed();
  }
  return { url, hostname, addresses };
}
