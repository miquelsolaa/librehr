import type { LookupAddress, LookupOptions } from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import type { LookupFunction } from "node:net";
import { ipVersion } from "@librehr/core";
import type { OutboundTarget } from "./outbound-url.js";

export interface OutboundRequest {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface OutboundResponse {
  /** HTTP status code. 3xx is returned as is: redirects are never followed. */
  status: number;
}

/** Sends a request to a guarded target; tests inject a fake. */
export type OutboundSender = (
  target: OutboundTarget,
  request: OutboundRequest,
) => Promise<OutboundResponse>;

type RequestFn = (
  options: https.RequestOptions,
  callback: (res: http.IncomingMessage) => void,
) => http.ClientRequest;

/**
 * A `lookup` that never touches DNS: it answers with the addresses the SSRF
 * guard already validated, so a rebinding answer (say 127.0.0.1) between the
 * check and the connect cannot redirect the socket.
 */
export function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const entries: LookupAddress[] = addresses.map((address) => ({
    address,
    family: ipVersion(address) === 6 ? 6 : 4,
  }));
  return (_hostname: string, options: LookupOptions, callback) => {
    const wanted =
      options.family === 4 || options.family === 6
        ? entries.filter((e) => e.family === options.family)
        : entries;
    const first = wanted[0];
    if (!first) {
      const err: NodeJS.ErrnoException = new Error("No pinned address");
      err.code = "ENOTFOUND";
      callback(err, "", undefined);
      return;
    }
    if (options.all) callback(null, wanted);
    else callback(null, first.address, first.family);
  };
}

/** Builds the node:http(s) options for a pinned request (exported for tests). */
export function pinnedRequestOptions(
  target: OutboundTarget,
  request: OutboundRequest,
): https.RequestOptions {
  const { url, hostname } = target;
  const isIp = ipVersion(hostname) !== 0;
  return {
    method: request.method,
    protocol: url.protocol,
    // The real hostname, not the IP: Node derives the Host header and the TLS
    // SNI / certificate check from it. Only the socket address is pinned.
    hostname,
    port: url.port === "" ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers: {
      ...request.headers,
      "Content-Length": String(Buffer.byteLength(request.body)),
    },
    lookup: pinnedLookup(target.addresses),
    // SNI must not carry an IP literal (RFC 6066).
    ...(isIp ? {} : { servername: hostname }),
    // No pooled keep-alive socket: each delivery connects to the addresses
    // validated for it, never to a socket opened after an earlier check.
    agent: false,
    timeout: request.timeoutMs,
    signal: AbortSignal.timeout(request.timeoutMs),
  };
}

/**
 * Sends one request to a target returned by `resolveOutboundTarget`, with
 * the socket pinned to its validated addresses. Uses node:http(s), which
 * never follows redirects; a 3xx is reported to the caller, so no hop can
 * reach an address the guard did not check. The response body is discarded.
 */
export function sendPinnedRequest(
  target: OutboundTarget,
  request: OutboundRequest,
  requestFn?: RequestFn,
): Promise<OutboundResponse> {
  const send: RequestFn =
    requestFn ??
    (target.url.protocol === "https:" ? https.request : http.request);
  return new Promise((resolve, reject) => {
    const req = send(pinnedRequestOptions(target, request), (res) => {
      resolve({ status: res.statusCode ?? 0 });
      res.destroy();
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end(request.body);
  });
}
