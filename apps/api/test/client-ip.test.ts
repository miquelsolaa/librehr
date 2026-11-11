import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { clientIp } from "../src/lib/client-ip.js";

async function resolve(
  trustProxy: number,
  forwardedFor: string | undefined,
  socket: string | undefined,
): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.text(clientIp(c, trustProxy)));
  const env = socket ? { incoming: { socket: { remoteAddress: socket } } } : {};
  const res = await app.request(
    "/",
    { headers: forwardedFor ? { "X-Forwarded-For": forwardedFor } : {} },
    env,
  );
  return res.text();
}

describe("clientIp", () => {
  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    expect(await resolve(0, "1.1.1.1", "203.0.113.7")).toBe("203.0.113.7");
    expect(await resolve(0, "1.1.1.1", undefined)).toBe("unknown");
  });

  it("takes the right-most untrusted hop behind one proxy", async () => {
    // Caddy appended the real client; "6.6.6.6" was supplied by the client.
    expect(await resolve(1, "6.6.6.6, 203.0.113.7", "172.18.0.5")).toBe(
      "203.0.113.7",
    );
    expect(await resolve(1, "203.0.113.7", "172.18.0.5")).toBe("203.0.113.7");
  });

  it("handles two trusted hops and short chains", async () => {
    expect(await resolve(2, "6.6.6.6, 203.0.113.7, 10.0.0.2", "10.0.0.1")).toBe(
      "203.0.113.7",
    );
    expect(await resolve(3, undefined, "10.0.0.1")).toBe("10.0.0.1");
  });
});
