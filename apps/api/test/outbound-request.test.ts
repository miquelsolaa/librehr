import { once } from "node:events";
import * as http from "node:http";
import type { LookupAddress } from "node:dns";
import type { AddressInfo } from "node:net";
import * as tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pinnedLookup,
  pinnedRequestOptions,
  sendPinnedRequest,
  type OutboundRequest,
} from "../src/lib/outbound-request.js";
import {
  resolveOutboundTarget,
  type HostResolver,
  type OutboundTarget,
} from "../src/lib/outbound-url.js";
import { ValidationError } from "../src/errors/index.js";

const request: OutboundRequest = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: '{"event":"test.ping"}',
  timeoutMs: 2000,
};

/**
 * A rebinding resolver: the first answer is the given one, every later
 * answer is loopback. Pinning means only the first one is ever used.
 */
function rebindingResolver(first: string[]) {
  let calls = 0;
  return vi.fn<HostResolver>(async () => {
    calls += 1;
    return calls === 1 ? first : ["127.0.0.1"];
  });
}

function lookupOnce(
  target: OutboundTarget,
  options: { all?: boolean; family?: number } = {},
): Promise<{ address: string | LookupAddress[]; family?: number }> {
  const { lookup } = pinnedRequestOptions(target, request);
  return new Promise((resolve, reject) => {
    lookup!(target.hostname, options, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, ...(family ? { family } : {}) });
    });
  });
}

const servers: { close: () => unknown }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function listen<T extends http.Server | tls.Server>(server: T) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

describe("DNS pinning for outbound webhooks (issue #35)", () => {
  it("connects to the validated IP even if a second lookup returns loopback", async () => {
    const resolve = rebindingResolver(["93.184.216.34"]);
    const target = await resolveOutboundTarget("https://hooks.example.com/x", {
      allowPrivate: false,
      resolve,
    });
    expect(target.addresses).toEqual(["93.184.216.34"]);

    // What the socket would connect to, asked twice, as Node may.
    await expect(lookupOnce(target)).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    });
    await expect(lookupOnce(target, { all: true })).resolves.toEqual({
      address: [{ address: "93.184.216.34", family: 4 }],
    });
    // The resolver is consulted once; the rebinding answer is never seen.
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("sends over a real socket to the pinned address, not a fresh lookup", async () => {
    const seen: { host?: string | undefined; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        seen.push({ host: req.headers.host, body });
        res.end("ok");
      });
    });
    const port = await listen(server);

    // `.invalid` never resolves through system DNS (RFC 6761), so reaching
    // the server proves the pinned address was used. The development escape
    // hatch lets the guard accept 127.0.0.1 here.
    const resolve = vi.fn<HostResolver>(async () => ["127.0.0.1"]);
    const target = await resolveOutboundTarget(
      `http://hooks.invalid:${port}/hook?x=1`,
      { allowPrivate: true, resolve },
    );
    const response = await sendPinnedRequest(target, request);

    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      { host: `hooks.invalid:${port}`, body: request.body },
    ]);
  });

  it("keeps the hostname for the Host header, SNI and certificate check", () => {
    const target: OutboundTarget = {
      url: new URL("https://hooks.example.com/services/x?y=1"),
      hostname: "hooks.example.com",
      addresses: ["93.184.216.34"],
    };
    const options = pinnedRequestOptions(target, request);
    expect(options).toMatchObject({
      hostname: "hooks.example.com",
      servername: "hooks.example.com",
      path: "/services/x?y=1",
      agent: false,
    });
    expect(options.headers).not.toHaveProperty("Host");
    expect(options.rejectUnauthorized).not.toBe(false);
  });

  it("presents the hostname as TLS SNI while connecting to the pinned IP", async () => {
    let sni: string | undefined;
    const server = tls.createServer({
      SNICallback: (servername, cb) => {
        sni = servername;
        // No certificate: the handshake aborts once SNI has been captured.
        cb(new Error("no certificate in tests"), undefined);
      },
    });
    server.on("tlsClientError", () => undefined);
    const port = await listen(server);

    const target: OutboundTarget = {
      url: new URL(`https://hooks.invalid:${port}/hook`),
      hostname: "hooks.invalid",
      addresses: ["127.0.0.1"],
    };
    await expect(sendPinnedRequest(target, request)).rejects.toBeDefined();
    expect(sni).toBe("hooks.invalid");
  });

  it("sends no SNI for an IP literal and strips IPv6 brackets", async () => {
    const target = await resolveOutboundTarget(
      "https://[2606:2800:220:1::1]/hook",
      { allowPrivate: false, resolve: vi.fn<HostResolver>() },
    );
    expect(target.hostname).toBe("2606:2800:220:1::1");
    const options = pinnedRequestOptions(target, request);
    expect(options.hostname).toBe("2606:2800:220:1::1");
    expect(options).not.toHaveProperty("servername");
  });

  it("answers lookups by requested family and fails when none is pinned", async () => {
    const lookup = pinnedLookup(["93.184.216.34", "2606:2800:220:1::1"]);
    const ask = (family: number) =>
      new Promise<string | LookupAddress[]>((resolve, reject) =>
        lookup("x", { family }, (err, address) =>
          err ? reject(err) : resolve(address),
        ),
      );
    await expect(ask(6)).resolves.toBe("2606:2800:220:1::1");
    await expect(ask(4)).resolves.toBe("93.184.216.34");
    await expect(
      new Promise((resolve, reject) =>
        pinnedLookup(["93.184.216.34"])("x", { family: 6 }, (err, a) =>
          err ? reject(err) : resolve(a),
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOTFOUND" });
  });

  it("never follows a redirect, so it cannot reach a private address", async () => {
    let internalHits = 0;
    const internal = http.createServer((_req, res) => {
      internalHits += 1;
      res.end("secret");
    });
    const internalPort = await listen(internal);
    const redirecting = http.createServer((req, res) => {
      req.resume();
      res.writeHead(302, {
        Location: `http://127.0.0.1:${internalPort}/latest/meta-data`,
      });
      res.end();
    });
    const port = await listen(redirecting);

    const target: OutboundTarget = {
      url: new URL(`http://hooks.invalid:${port}/hook`),
      hostname: "hooks.invalid",
      addresses: ["127.0.0.1"],
    };
    const response = await sendPinnedRequest(target, request);
    expect(response.status).toBe(302);
    expect(internalHits).toBe(0);
  });

  it.each([
    ["loopback", ["127.0.0.1"]],
    ["private", ["10.0.0.5"]],
    ["link-local metadata", ["169.254.169.254"]],
    ["IPv6 loopback", ["::1"]],
    ["IPv6 link-local", ["fe80::1"]],
    ["IPv6 unique-local", ["fd00::1"]],
    ["IPv4-mapped loopback", ["::ffff:127.0.0.1"]],
    ["IPv4-mapped private", ["::ffff:192.168.1.10"]],
    ["IPv4-mapped hex form", ["::ffff:a9fe:a9fe"]],
    ["one private among public", ["93.184.216.34", "10.0.0.1"]],
    ["a non-IP answer", ["not-an-ip"]],
    ["no answer", []],
  ])("refuses a host resolving to %s", async (_label, addresses) => {
    const resolve = vi.fn<HostResolver>(async () => addresses);
    const err = await resolveOutboundTarget("https://hooks.example.com/x", {
      allowPrivate: false,
      resolve,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe("OUTBOUND_URL_NOT_ALLOWED");
  });

  it.each([
    "https://[::ffff:127.0.0.1]/x",
    "https://[::ffff:7f00:1]/x",
    "https://[fe80::1]/x",
    "https://169.254.169.254/x",
    "http://hooks.example.com/x",
  ])("refuses %s before any lookup", async (url) => {
    const resolve = vi.fn<HostResolver>(async () => ["93.184.216.34"]);
    await expect(
      resolveOutboundTarget(url, { allowPrivate: false, resolve }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(resolve).not.toHaveBeenCalled();
  });
});
