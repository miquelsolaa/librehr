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
 * Guards outbound requests against SSRF: the URL must be https and every
 * address its host resolves to must be publicly routable (no loopback,
 * private, CGNAT, link-local/metadata, unique-local or multicast, including
 * IPv4-mapped IPv6 forms). Call it when the URL is stored and again right
 * before each request, since DNS answers can change in between.
 */
export async function assertPublicHttpsUrl(
  raw: string,
  policy: OutboundUrlPolicy,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw notAllowed();
  }

  if (policy.allowPrivate) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw notAllowed();
    }
    return url;
  }

  if (url.protocol !== "https:") throw notAllowed();

  // WHATWG URL already normalises numeric hosts (0x7f.1, 2130706433) to
  // dotted IPv4 and keeps IPv6 literals in brackets.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (ipVersion(host) !== 0) {
    if (!isPublicIpAddress(host)) throw notAllowed();
    return url;
  }

  let addresses: string[];
  try {
    addresses = await (policy.resolve ?? systemHostResolver)(host);
  } catch {
    throw notAllowed();
  }
  if (
    addresses.length === 0 ||
    !addresses.every((address) => isPublicIpAddress(address))
  ) {
    throw notAllowed();
  }
  return url;
}
