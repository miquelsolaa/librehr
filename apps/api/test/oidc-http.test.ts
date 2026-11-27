import { describe, expect, it, vi } from "vitest";
import {
  OIDC_MAX_RESPONSE_BYTES,
  OIDC_TIMEOUT_MS,
  createOidcHttpClient,
} from "../src/lib/oidc-http.js";
import type { OutboundSender } from "../src/lib/outbound-request.js";
import type { HostResolver } from "../src/lib/outbound-url.js";
import { ValidationError } from "../src/errors/index.js";

const publicHost = vi.fn<HostResolver>(async () => ["93.184.216.34"]);

describe("OIDC HTTP client for Business sign-in (AUTH-004)", () => {
  it("GETs through the guard with the time and size caps and parses JSON", async () => {
    const send = vi.fn<OutboundSender>(async () => ({
      status: 200,
      body: '{"issuer":"https://idp.example.com"}',
    }));
    const http = createOidcHttpClient({
      allowPrivate: false,
      resolve: publicHost,
      send,
    });

    const res = await http({
      method: "GET",
      url: "https://idp.example.com/.well-known/openid-configuration",
    });

    expect(res).toEqual({
      status: 200,
      json: { issuer: "https://idp.example.com" },
    });
    const [target, request] = send.mock.calls[0]!;
    expect(target.addresses).toEqual(["93.184.216.34"]);
    expect(request).toEqual({
      method: "GET",
      headers: { Accept: "application/json" },
      body: undefined,
      timeoutMs: OIDC_TIMEOUT_MS,
      maxResponseBytes: OIDC_MAX_RESPONSE_BYTES,
    });
  });

  it("POSTs a form body with the caller's headers", async () => {
    const send = vi.fn<OutboundSender>(async () => ({
      status: 400,
      body: '{"error":"invalid_grant"}',
    }));
    const http = createOidcHttpClient({
      allowPrivate: false,
      resolve: publicHost,
      send,
    });
    const res = await http({
      method: "POST",
      url: "https://idp.example.com/token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=x",
    });
    expect(res).toEqual({ status: 400, json: { error: "invalid_grant" } });
    expect(send.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=authorization_code&code=x",
    });
  });

  it.each([
    ["an HTML page", "<html>no</html>"],
    ["an empty body", ""],
    ["no body", undefined],
  ])("answers json null for %s", async (_label, body) => {
    const http = createOidcHttpClient({
      allowPrivate: false,
      resolve: publicHost,
      send: async () => ({ status: 502, body }),
    });
    await expect(
      http({ method: "GET", url: "https://idp.example.com/jwks" }),
    ).resolves.toEqual({ status: 502, json: null });
  });

  it.each([
    "http://idp.example.com/.well-known/openid-configuration",
    "https://127.0.0.1/token",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/jwks",
    "not a url",
  ])("refuses %s without sending anything", async (url) => {
    const send = vi.fn<OutboundSender>();
    const http = createOidcHttpClient({
      allowPrivate: false,
      resolve: publicHost,
      send,
    });
    const err = await http({ method: "GET", url }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe("OUTBOUND_URL_NOT_ALLOWED");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a public name that resolves to an internal address", async () => {
    const send = vi.fn<OutboundSender>();
    const http = createOidcHttpClient({
      allowPrivate: false,
      resolve: async () => ["10.0.0.7"],
      send,
    });
    await expect(
      http({ method: "GET", url: "https://idp.example.com/jwks" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(send).not.toHaveBeenCalled();
  });

  it("propagates a transport failure (timeout, oversized body)", async () => {
    const http = createOidcHttpClient({
      allowPrivate: false,
      resolve: publicHost,
      send: async () => {
        throw new Error("Request timed out");
      },
    });
    await expect(
      http({ method: "GET", url: "https://idp.example.com/jwks" }),
    ).rejects.toThrow("Request timed out");
  });
});
