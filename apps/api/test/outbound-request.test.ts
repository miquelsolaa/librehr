import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
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
 * A rebinding resolver: the first answer is `first`, every later answer is
 * `later` (loopback by default). Pinning means only the first is ever used.
 */
function rebindingResolver(first: string[], later: string[] = ["127.0.0.1"]) {
  let calls = 0;
  return vi.fn<HostResolver>(async () => {
    calls += 1;
    return calls === 1 ? first : later;
  });
}

// Test-only throwaway certificate for another name (see the fixture header).
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url), "utf8");
const otherHostKey = fixture("test-only-other-host.key.pem");
const otherHostCert = fixture("test-only-other-host.cert.pem");

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

const servers: (http.Server | tls.Server)[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    if (s instanceof http.Server) s.closeAllConnections();
    s.close();
  }
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

  it("sends over a real socket to the pinned address even if DNS rebinds", async () => {
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
    // the server proves the pinned address was used. Later answers rebind to
    // an unreachable TEST-NET address. The development escape hatch lets the
    // guard accept 127.0.0.1 here.
    const resolve = rebindingResolver(["127.0.0.1"], ["192.0.2.1"]);
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

  it("rejects with a certificate error when the server's certificate is not trusted", async () => {
    const server = https.createServer(
      { key: otherHostKey, cert: otherHostCert },
      (_req, res) => res.end("must not be reached"),
    );
    const port = await listen(server);
    const target: OutboundTarget = {
      url: new URL(`https://hooks.invalid:${port}/hook`),
      hostname: "hooks.invalid",
      addresses: ["127.0.0.1"],
    };
    // Even with the global escape hatch set, verification stays on.
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    try {
      await expect(sendPinnedRequest(target, request)).rejects.toMatchObject({
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("checks the certificate against the hostname, not the pinned IP", async () => {
    const server = https.createServer(
      { key: otherHostKey, cert: otherHostCert },
      (req, res) => {
        req.resume();
        res.end("ok");
      },
    );
    const port = await listen(server);
    // Trust the throwaway certificate so only the name check is left.
    const trusting = ((options, callback) =>
      https.request({ ...options, ca: otherHostCert }, callback)) as Parameters<
      typeof sendPinnedRequest
    >[2];

    const mismatch: OutboundTarget = {
      url: new URL(`https://hooks.invalid:${port}/hook`),
      hostname: "hooks.invalid",
      addresses: ["127.0.0.1"],
    };
    await expect(
      sendPinnedRequest(mismatch, request, trusting),
    ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });

    // Control: same pinned IP, hostname matching the certificate.
    const matching: OutboundTarget = {
      url: new URL(`https://not-the-webhook-host.invalid:${port}/hook`),
      hostname: "not-the-webhook-host.invalid",
      addresses: ["127.0.0.1"],
    };
    await expect(
      sendPinnedRequest(matching, request, trusting),
    ).resolves.toEqual({ status: 200 });
  });

  it("rejects when the endpoint accepts but never answers", async () => {
    // Holds the request open: no response is ever written.
    const server = http.createServer(() => undefined);
    const port = await listen(server);
    const target: OutboundTarget = {
      url: new URL(`http://hooks.invalid:${port}/hook`),
      hostname: "hooks.invalid",
      addresses: ["127.0.0.1"],
    };
    await expect(
      sendPinnedRequest(target, { ...request, timeoutMs: 200 }),
    ).rejects.toBeInstanceOf(Error);
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
    expect(options.rejectUnauthorized).toBe(true);
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

  it("answers lookups asynchronously, by requested family, and fails when none is pinned", async () => {
    const lookup = pinnedLookup(["93.184.216.34", "2606:2800:220:1::1"]);
    const ask = (family: number | "IPv4" | "IPv6", addresses = lookup) =>
      new Promise<string | LookupAddress[]>((resolve, reject) => {
        let sync = true;
        addresses("x", { family }, (err, address) => {
          if (sync) reject(new Error("callback ran synchronously"));
          else if (err) reject(err);
          else resolve(address);
        });
        sync = false;
      });
    await expect(ask(6)).resolves.toBe("2606:2800:220:1::1");
    await expect(ask("IPv6")).resolves.toBe("2606:2800:220:1::1");
    await expect(ask(4)).resolves.toBe("93.184.216.34");
    await expect(ask("IPv4")).resolves.toBe("93.184.216.34");
    await expect(ask(0)).resolves.toBe("93.184.216.34");
    await expect(
      ask("IPv6", pinnedLookup(["93.184.216.34"])),
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
    ["IPv4-translated loopback", ["::ffff:0:127.0.0.1"]],
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
