import type { LookupAddress, LookupOptions } from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import type { LookupFunction } from "node:net";
import { ipVersion } from "@librehr/core";
import type { OutboundTarget } from "./outbound-url.js";

export interface OutboundRequest {
  method: "GET" | "POST";
  headers: Record<string, string>;
  /** Request body; GET requests send none. */
  body?: string | undefined;
  timeoutMs: number;
  /**
   * When set, the response body is read and returned, up to this many
   * bytes; a longer body rejects with {@link ResponseTooLargeError}. Without
   * it the body is discarded (webhook deliveries).
   */
  maxResponseBytes?: number | undefined;
}

export interface OutboundResponse {
  /** HTTP status code. 3xx is returned as is: redirects are never followed. */
  status: number;
  /** UTF-8 body, only when the request set `maxResponseBytes`. */
  body?: string | undefined;
}

/** The response body exceeded the request's `maxResponseBytes`. */
export class ResponseTooLargeError extends Error {
  constructor() {
    super("Response body too large");
    this.name = "ResponseTooLargeError";
  }
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

/** dns.LookupOptions.family may be 0, 4, 6, "IPv4" or "IPv6". */
function familyNumber(family: LookupOptions["family"]): 4 | 6 | undefined {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return undefined;
}

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
    const family = familyNumber(options.family);
    const wanted = family
      ? entries.filter((e) => e.family === family)
      : entries;
    const first = wanted[0];
    // Asynchronous like dns.lookup: callers may not expect a synchronous
    // callback before they finish wiring their socket.
    process.nextTick(() => {
      if (!first) {
        const err: NodeJS.ErrnoException = new Error("No pinned address");
        err.code = "ENOTFOUND";
        callback(err, "", undefined);
      } else if (options.all) {
        callback(null, wanted);
      } else {
        callback(null, first.address, first.family);
      }
    });
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
    headers:
      request.body === undefined
        ? request.headers
        : {
            ...request.headers,
            "Content-Length": String(Buffer.byteLength(request.body)),
          },
    lookup: pinnedLookup(target.addresses),
    // SNI must not carry an IP literal (RFC 6066).
    ...(isIp ? {} : { servername: hostname }),
    // Explicit, so NODE_TLS_REJECT_UNAUTHORIZED=0 in the environment cannot
    // turn off certificate verification for webhook deliveries.
    rejectUnauthorized: true,
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
 * reach an address the guard did not check. The response body is discarded
 * unless the request sets `maxResponseBytes`; then it is read up to that cap,
 * so a hostile server cannot make the API buffer an unbounded answer.
 *
 * HTTP_PROXY / HTTPS_PROXY are deliberately not honoured: a proxy would
 * resolve the hostname itself and undo the pinning.
 */
export function sendPinnedRequest(
  target: OutboundTarget,
  request: OutboundRequest,
  requestFn?: RequestFn,
): Promise<OutboundResponse> {
  const send: RequestFn =
    requestFn ??
    (target.url.protocol === "https:" ? https.request : http.request);
  const limit = request.maxResponseBytes;
  return new Promise((resolve, reject) => {
    const req = send(pinnedRequestOptions(target, request), (res) => {
      const status = res.statusCode ?? 0;
      if (limit === undefined) {
        resolve({ status });
        res.destroy();
        return;
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > limit) {
        res.destroy();
        reject(new ResponseTooLargeError());
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          res.destroy();
          reject(new ResponseTooLargeError());
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () =>
        resolve({ status, body: Buffer.concat(chunks).toString("utf8") }),
      );
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end(request.body);
  });
}
