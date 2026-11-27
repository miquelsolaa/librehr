import type { MiddlewareHandler } from "hono";

export const securityHeadersMiddleware: MiddlewareHandler = async (c, next) => {
  await next();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  // A route may only make it stricter: the SSO callback (AUTH-004) sends
  // no-referrer so its code/state URL never leaks to the next page.
  if (c.res.headers.get("Referrer-Policy") !== "no-referrer") {
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none';",
  );
  c.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (process.env["NODE_ENV"] === "production") {
    c.header(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
};
