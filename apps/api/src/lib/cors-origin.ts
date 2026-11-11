export interface CorsOriginPolicy {
  nodeEnv: "development" | "test" | "production";
  /** Exact origins (scheme://host[:port]) allowed in every environment. */
  allowedOrigins: readonly string[];
}

const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * Returns the CORS `origin` callback. Credentials are allowed, so only exact
 * configured origins are echoed back; any-port localhost is a development
 * convenience that never applies in production.
 */
export function createCorsOriginMatcher(
  policy: CorsOriginPolicy,
): (origin: string) => string | null {
  const allowed = new Set(policy.allowedOrigins);
  const allowLocal = policy.nodeEnv !== "production";
  return (origin) => {
    if (!origin) return null;
    if (allowed.has(origin)) return origin;
    if (allowLocal && LOCAL_DEV_ORIGIN.test(origin)) return origin;
    return null;
  };
}
