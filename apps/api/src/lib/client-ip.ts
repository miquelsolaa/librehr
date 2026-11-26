import type { Context } from "hono";
import { isIPv6 } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";

/** Socket peer address, or null outside the Node adapter (e.g. app.request in tests). */
function socketAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

/**
 * The client IP for rate limiting and logging.
 *
 * `trustProxy` is the number of reverse proxies in front of the API that
 * append to X-Forwarded-For (TRUST_PROXY). Every hop appends the address it
 * received the request from, so with N trusted hops the client is the N-th
 * entry from the right of `[...X-Forwarded-For, socket address]`. Entries to
 * the left of it are client-supplied and ignored. With 0 trusted hops the
 * header is ignored entirely and the socket address is used.
 *
 * Example: TRUST_PROXY=1 (Caddy), header "1.1.1.1, 203.0.113.7", socket
 * 172.18.0.5 -> "203.0.113.7" (the spoofed "1.1.1.1" is never used).
 */
export function clientIp(c: Context, trustProxy: number): string {
  const socket = socketAddress(c);
  if (trustProxy <= 0) return socket ?? "unknown";

  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const chain = socket ? [...forwarded, socket] : forwarded;
  if (chain.length === 0) return "unknown";
  const index = Math.max(0, chain.length - 1 - trustProxy);
  return chain[index] ?? "unknown";
}

/**
 * The address a rate limit counts against. An IPv6 client usually holds a
 * whole /64 and can rotate through it freely, so IPv6 addresses are grouped
 * by their /64 prefix; IPv4 (and IPv4-mapped IPv6) addresses count alone.
 *
 * Example: "2001:db8:1:2:aaaa::1" -> "2001:db8:1:2::/64";
 * "::ffff:203.0.113.7" -> "203.0.113.7".
 */
export function rateLimitAddress(ip: string): string {
  const address = (ip.split("%")[0] ?? ip).toLowerCase();
  if (!isIPv6(address)) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1]) return mapped[1];
  // A trailing dotted quad fills the last two 16-bit groups.
  const groups = (part: string) =>
    part
      ? part.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]))
      : [];
  const [head = "", tail] = address.split("::");
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const zeros = Array<string>(8 - left.length - right.length).fill("0");
  const all = tail === undefined ? left : [...left, ...zeros, ...right];
  const prefix = all
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":");
  return `${prefix}::/64`;
}
