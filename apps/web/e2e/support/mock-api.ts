import type { Page, Request, Route } from "@playwright/test";

/**
 * Shared helpers for specs that mock the API with `page.route`.
 *
 * The web client calls the API cross-origin with `credentials: "include"`
 * (the session is an httpOnly cookie), so browsers reject a response that
 * answers `access-control-allow-origin: *`. Mocks must behave like the real
 * API: echo the caller's Origin, allow credentials and answer preflights.
 */

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const EXPOSED_HEADERS =
  "Content-Length, X-Request-ID, X-Export-Id, X-Content-SHA256";

type FulfillOptions = NonNullable<Parameters<Route["fulfill"]>[0]>;

/** CORS headers for a credentialed response to `request`. */
export function corsHeaders(request: Request): Record<string, string> {
  const requestHeaders = request.headers();
  const origin = requestHeaders["origin"];
  return {
    ...(origin ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-credentials": "true",
    // "*" is not a wildcard on credentialed requests; echo what was asked.
    "access-control-allow-headers":
      requestHeaders["access-control-request-headers"] ?? "content-type",
    "access-control-allow-methods": ALLOWED_METHODS,
    // Same list as the API: scripts can only read exposed headers cross-origin.
    "access-control-expose-headers": EXPOSED_HEADERS,
    vary: "Origin",
  };
}

/**
 * The subset of `Route` a mock handler uses. `fulfill` always carries the
 * CORS headers; headers passed by the handler are added on top.
 */
export interface MockRoute {
  request(): Request;
  fulfill(options?: FulfillOptions): Promise<void>;
  abort: Route["abort"];
  fallback: Route["fallback"];
}

export type MockHandler = (route: MockRoute) => unknown;

/**
 * Like `page.route`, but answers CORS preflights itself and adds credentialed
 * CORS headers to every fulfilled response. Handlers only see real requests.
 */
export async function mockRoute(
  page: Page,
  url: Parameters<Page["route"]>[0],
  handler: MockHandler,
): Promise<void> {
  await page.route(url, async (route) => {
    const request = route.request();
    const cors = corsHeaders(request);
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: cors });
    }
    const mock: MockRoute = {
      request: () => request,
      fulfill: (options = {}) =>
        route.fulfill({
          ...options,
          headers: { ...cors, ...options.headers },
        }),
      abort: (errorCode) => route.abort(errorCode),
      fallback: (options) => route.fallback(options),
    };
    await handler(mock);
  });
}

export interface StoredProfile {
  userId?: string;
  organizationId?: string;
  email?: string;
  name?: string;
  role?: string;
  /** Only to simulate a profile cached by a version that stored a token. */
  token?: string;
}

/**
 * Seeds the cached, non-secret profile the shell renders from. The real
 * session is the API's httpOnly cookie, which mocked APIs do not check.
 */
export async function seedProfile(
  page: Page,
  profile: StoredProfile = {},
): Promise<void> {
  await page.addInitScript(
    (value) =>
      localStorage.setItem("librehr_auth_session", JSON.stringify(value)),
    {
      userId: "sample",
      organizationId: "sample",
      email: "sample@example.invalid",
      role: "employee",
      ...profile,
    },
  );
}
