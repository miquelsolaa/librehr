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
 * by their /64 prefix. IPv4 addresses count alone, and so do IPv6 addresses
 * that embed one, in any spelling: IPv4-mapped (::ffff:a.b.c.d, also
 * written in hex or in full), IPv4-translated (::ffff:0:a.b.c.d) and the
 * deprecated IPv4-compatible form (::a.b.c.d). Otherwise every IPv4 client
 * seen through a dual-stack socket would share one ::/64 budget.
 *
 * Example: "2001:db8:1:2:aaaa::1" -> "2001:db8:1:2::/64";
 * "::ffff:cb00:7107" -> "203.0.113.7".
 */
export function rateLimitAddress(ip: string): string {
  const address = (ip.split("%")[0] ?? ip).toLowerCase();
  if (!isIPv6(address)) return ip;
  const g = expandIPv6(address);
  const zero = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0);
  const embedded =
    (zero(0, 5) && g[5] === 0xffff) || // IPv4-mapped
    (zero(0, 4) && g[4] === 0xffff && g[5] === 0) || // IPv4-translated
    (zero(0, 6) && (g[6] ?? 0) !== 0); // IPv4-compatible (not :: or ::1)
  if (embedded) {
    const hi = g[6] ?? 0;
    const lo = g[7] ?? 0;
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(":")}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address (dotted tail included). */
function expandIPv6(address: string): number[] {
  const groups = (part: string) =>
    part
      ? part.split(":").flatMap((x) => {
          if (!x.includes(".")) return [parseInt(x, 16)];
          const [a = 0, b = 0, c = 0, d = 0] = x.split(".").map(Number);
          return [(a << 8) | b, (c << 8) | d];
        })
      : [];
  const [head = "", tail] = address.split("::");
  const left = groups(head);
  if (tail === undefined) return left;
  const right = groups(tail);
  return [
    ...left,
    ...Array<number>(8 - left.length - right.length).fill(0),
    ...right,
  ];
}
