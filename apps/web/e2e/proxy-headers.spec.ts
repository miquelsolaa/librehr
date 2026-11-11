import { expect, test } from "@playwright/test";

// Guards apps/web/src/proxy.ts (Next 16 renamed middleware to proxy): if the
// file stopped being picked up, pages would ship without security headers and
// without the locale redirect, and nothing else would fail.

test("pages carry the security headers", async ({ request }) => {
  const res = await request.get("/en/sign-in");
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=()",
  );
});

test("paths without a locale redirect to a locale-prefixed URL", async ({
  request,
}) => {
  for (const path of ["/", "/people"]) {
    const res = await request.get(path, {
      maxRedirects: 0,
      headers: { "accept-language": "en" },
    });
    expect(res.status(), path).toBeGreaterThanOrEqual(300);
    expect(res.status(), path).toBeLessThan(400);
    expect(res.headers()["location"], path).toMatch(
      new RegExp(`/en${path === "/" ? "/?" : path}$`),
    );
  }
});

test("a chosen locale is remembered for a year", async ({ request }) => {
  // The cookie is written when the URL locale differs from the browser's.
  const res = await request.get("/es/sign-in", {
    headers: { "accept-language": "en" },
  });
  const cookie = res
    .headersArray()
    .find(
      (h) =>
        h.name.toLowerCase() === "set-cookie" &&
        h.value.startsWith("NEXT_LOCALE="),
    );
  expect(cookie?.value).toMatch(/^NEXT_LOCALE=es;/);
  expect(cookie?.value).toMatch(/Max-Age=31536000/i);
});
