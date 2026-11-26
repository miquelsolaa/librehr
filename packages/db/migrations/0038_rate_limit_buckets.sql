-- 0038_rate_limit_buckets.sql
-- Issue #35 (AUTH-001, AUTH-003, TIM-010): request rate limits and failure
-- lockouts move from per-process memory to Postgres, so several API replicas
-- share one budget per client instead of one each.
--
-- One row per bucket. A rate-limit bucket is a fixed window (window_start,
-- count, expires_at = end of the window). A lockout bucket counts failures in
-- a window and sets locked_until once the limit is reached; its expires_at is
-- the later of the window end and locked_until. Every write is a single
-- INSERT ... ON CONFLICT DO UPDATE (RateLimitRepository), so concurrent
-- replicas never lose a count. Times come from the database clock
-- (statement_timestamp()), so clock skew between API replicas cannot restart
-- a window or sweep a live lockout. The API deletes expired rows
-- opportunistically through the expires_at index.
--
-- Tenancy / RLS decision: a global system table, like users and sessions,
-- not a tenant table. The limits run before authentication (sign-in, 2FA
-- challenge, setup wizard), where no organization is known, and their keys
-- (a client IP, an account) are cross-tenant by nature. So there is no
-- organization_id and no RLS policy. It holds no tenant rows and no data in
-- clear: `key` is an HMAC-SHA256 digest of the namespaced bucket key, computed
-- by the API with a server-side secret, never a raw email, IP or identifier.
-- Such a digest is still pseudonymised personal data (GDPR art. 4.5); it is
-- kept only until expires_at (minutes) and then swept.
-- The CHECK constraint rejects anything but a 64-char hex digest, so a raw
-- value cannot be stored by mistake. No RLS is disabled on any tenant table
-- and no role gains BYPASSRLS.
--
-- Rollback (forward-only in practice): DROP TABLE rate_limit_buckets; the
-- previous release does not read it.

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "key" text PRIMARY KEY,
  "window_start" timestamptz NOT NULL,
  "count" integer NOT NULL,
  "locked_until" timestamptz,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "rate_limit_buckets_key_digest" CHECK ("key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "rate_limit_buckets_count_nonnegative" CHECK ("count" >= 0)
)
-- Every request updates its row in place: leave room on each page so most
-- updates stay HOT (no index churn). The table stays LOGGED, so lockouts
-- survive a crash or failover.
WITH (fillfactor = 70);

CREATE INDEX IF NOT EXISTS "rate_limit_buckets_expires_at_idx"
  ON "rate_limit_buckets" ("expires_at");

-- Explicit, in case the default privileges of 0015 belong to another role
-- than the one running this migration (same loop as 0025/0031).
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['librehr_app', 'openhr_app'] LOOP
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_limit_buckets" TO %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE "rate_limit_buckets" IS
  'Issue #35: shared rate-limit and lockout counters. Global (pre-auth, cross-tenant), no RLS; keys are HMAC digests; rows expire within minutes.';
