import type { Context } from "hono";
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
