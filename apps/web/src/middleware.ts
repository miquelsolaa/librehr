import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "@openhr/i18n";

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
});

export function middleware(request: NextRequest): NextResponse {
  // Pass through internal next paths, static files, and healthz API
  if (
    request.nextUrl.pathname.startsWith("/_next") ||
    request.nextUrl.pathname.startsWith("/api/healthz") ||
    request.nextUrl.pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const response = intlMiddleware(request);

  // Generate CSP nonce
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Security headers per COMPLIANCE.md & ARCHITECTURE.md
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set("x-nonce", nonce);

  // Content-Security-Policy (strictly self-hosted, no external CDNs)
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:;
    font-src 'self' data:;
    connect-src 'self' http://localhost:* http://127.0.0.1:*;
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  response.headers.set("Content-Security-Policy", cspHeader);

  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*|api/healthz).*)"],
};
