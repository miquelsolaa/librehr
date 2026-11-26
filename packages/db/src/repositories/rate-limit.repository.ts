import type { Sql } from "postgres";

/** One counted request: the count in the current window and when it ends. */
export interface RateLimitHit {
  count: number;
  resetAt: Date;
}

export interface FailurePolicy {
  /** Failures within the window that trigger a lockout. */
  limit: number;
  /** Failures older than this no longer count. */
  windowMs: number;
  /** How long a lockout lasts. */
  lockoutMs: number;
}

const MAX_COUNT = 2_147_483_647;
const at = (ms: number) => new Date(ms);

/**
 * Shared counters for request rate limits and failure lockouts (issue #35),
 * in the global table `rate_limit_buckets` (migration 0038): pre-auth and
 * cross-tenant, so no tenant context and no RLS. Callers pass HMAC digests as
 * keys (the table's CHECK rejects anything else) and the current time, so
 * tests can drive the clock. Every write is one atomic upsert: concurrent API
 * replicas never lose a count.
 */
export class RateLimitRepository {
  /**
   * Counts one request in a fixed window of `windowMs`. A window that has
   * ended (its end <= now) restarts at `now` with a count of 1.
   */
  async hit(
    sql: Sql,
    key: string,
    nowMs: number,
    windowMs: number,
  ): Promise<RateLimitHit> {
    const now = at(nowMs);
    const windowEnd = at(nowMs + windowMs);
    const rows = await sql<{ count: number; resetAt: Date }[]>`
      INSERT INTO rate_limit_buckets AS b (key, window_start, count, expires_at)
      VALUES (${key}, ${now}, 1, ${windowEnd})
      ON CONFLICT (key) DO UPDATE SET
        window_start = CASE WHEN b.expires_at <= ${now} THEN ${now} ELSE b.window_start END,
        count = CASE WHEN b.expires_at <= ${now} THEN 1
                     WHEN b.count >= ${MAX_COUNT}::int THEN b.count
                     ELSE b.count + 1 END,
        expires_at = CASE WHEN b.expires_at <= ${now} THEN ${windowEnd} ELSE b.expires_at END
      RETURNING count, expires_at AS "resetAt"
    `;
    const row = rows[0];
    const count = Number(row?.count);
    const resetAt = new Date(row?.resetAt ?? Number.NaN);
    // Fail closed: a missing or malformed row must never let requests through.
    if (!Number.isFinite(count) || Number.isNaN(resetAt.getTime())) {
      throw new Error("rate limit upsert returned no valid row");
    }
    return { count, resetAt };
  }

  /**
   * Records one failure. Failures restart from zero once the window that
   * began with the first of them is over (now - window_start > windowMs);
   * reaching `limit` locks the key until now + lockoutMs and starts a new
   * window.
   */
  async recordFailure(
    sql: Sql,
    key: string,
    nowMs: number,
    policy: FailurePolicy,
  ): Promise<void> {
    const now = at(nowMs);
    const stale = at(nowMs - policy.windowMs);
    const windowEnd = at(nowMs + policy.windowMs);
    const lockEnd = at(nowMs + policy.lockoutMs);
    const lockExpiry = at(nowMs + Math.max(policy.windowMs, policy.lockoutMs));
    const lockNow = policy.limit <= 1;
    // Failures in the current window including this one.
    const n = sql`(CASE WHEN b.window_start < ${stale} THEN 0 ELSE b.count END) + 1`;
    const reached = sql`${n} >= ${policy.limit}::int`;
    const fresh = sql`b.window_start < ${stale}`;
    await sql`
      INSERT INTO rate_limit_buckets AS b (key, window_start, count, locked_until, expires_at)
      VALUES (
        ${key}, ${now}, ${lockNow ? 0 : 1},
        ${lockNow ? lockEnd : null}::timestamptz,
        ${lockNow ? lockExpiry : windowEnd}
      )
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN ${reached} THEN 0 ELSE ${n} END,
        window_start = CASE WHEN ${reached} OR ${fresh} THEN ${now} ELSE b.window_start END,
        locked_until = CASE WHEN ${reached} THEN ${lockEnd}::timestamptz
                            WHEN ${fresh} THEN NULL ELSE b.locked_until END,
        expires_at = CASE WHEN ${reached} THEN ${lockExpiry}
                          WHEN ${fresh} THEN ${windowEnd} ELSE b.expires_at END
    `;
  }

  /** The latest lockout end among `keys` still in the future, or null. */
  async lockedUntil(
    sql: Sql,
    keys: readonly string[],
    nowMs: number,
  ): Promise<Date | null> {
    if (keys.length === 0) return null;
    const rows = await sql<{ until: Date | null }[]>`
      SELECT max(locked_until) AS until FROM rate_limit_buckets
      WHERE key = ANY(${[...keys]}::text[]) AND locked_until > ${at(nowMs)}
    `;
    const until = rows[0]?.until;
    return until ? new Date(until) : null;
  }

  /** Forgets a key (a successful attempt clears its failures). */
  async remove(sql: Sql, key: string): Promise<void> {
    await sql`DELETE FROM rate_limit_buckets WHERE key = ${key}`;
  }

  /**
   * Deletes up to `batch` buckets that expired before `nowMs`. The outer
   * condition is re-checked on rows a concurrent upsert just restarted, so a
   * fresh window or lockout is never swept.
   */
  async deleteExpired(sql: Sql, nowMs: number, batch = 1000): Promise<number> {
    const rows = await sql`
      DELETE FROM rate_limit_buckets
      WHERE expires_at < ${at(nowMs)} AND key IN (
        SELECT key FROM rate_limit_buckets
        WHERE expires_at < ${at(nowMs)}
        LIMIT ${batch}::int
        FOR UPDATE SKIP LOCKED
      )
    `;
    return rows.count;
  }
}
