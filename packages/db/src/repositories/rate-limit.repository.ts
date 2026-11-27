import type { PendingQuery, Row, Sql } from "postgres";

/** One counted request: the count in the current window and ms until it ends. */
export interface RateLimitHit {
  count: number;
  resetInMs: number;
}

export interface FailurePolicy {
  /** Failures (or reserved attempts) within the window that trigger a lockout. */
  limit: number;
  /** Failures older than this no longer count. */
  windowMs: number;
  /** How long a lockout lasts. */
  lockoutMs: number;
}

/**
 * Result of reserving an attempt: allowed, or refused with the lock's
 * remaining ms. `lockToken` is set when this attempt reached the limit and
 * locked the key; pass it to `release` so that a successful attempt can lift
 * the lock it set itself.
 */
export type AttemptReservation =
  { allowed: true; lockToken?: string } | { allowed: false; lockedMs: number };

export interface SweepOptions {
  /** Rows per DELETE. */
  batch?: number | undefined;
  /** Stop starting new batches after this many ms of wall time. */
  budgetMs?: number | undefined;
  /** Test override of the database clock (epoch ms). */
  nowMs?: number | undefined;
}

const MAX_COUNT = 2_147_483_647;
type Fragment = PendingQuery<Row[]>;

/**
 * Shared counters for request rate limits and failure lockouts (issue #35),
 * in the global table `rate_limit_buckets` (migration 0038): pre-auth and
 * cross-tenant, so no tenant context and no RLS. Callers pass HMAC digests as
 * keys (the table's CHECK rejects anything else).
 *
 * Every write is one atomic upsert, so concurrent API replicas never lose a
 * count. Time comes from the database (`statement_timestamp()`), so replica
 * clock skew cannot restart a window or sweep a live lockout; `nowMs` is a
 * test-only override.
 */
export class RateLimitRepository {
  /**
   * Counts one request in a fixed window of `windowMs`. A window that has
   * ended (its end <= now) restarts at `now` with a count of 1.
   */
  async hit(
    sql: Sql,
    key: string,
    windowMs: number,
    nowMs?: number,
  ): Promise<RateLimitHit> {
    const now = clock(sql, nowMs);
    const windowEnd = plus(sql, now, windowMs);
    const rows = await sql<{ count: number; resetInMs: number }[]>`
      INSERT INTO rate_limit_buckets AS b (key, window_start, count, expires_at)
      VALUES (${key}, ${now}, 1, ${windowEnd})
      ON CONFLICT (key) DO UPDATE SET
        window_start = CASE WHEN b.expires_at <= ${now} THEN ${now} ELSE b.window_start END,
        count = CASE WHEN b.expires_at <= ${now} THEN 1
                     WHEN b.count >= ${MAX_COUNT}::int THEN b.count
                     ELSE b.count + 1 END,
        expires_at = CASE WHEN b.expires_at <= ${now} THEN ${windowEnd} ELSE b.expires_at END
      RETURNING count, ${remainingMs(sql, sql`expires_at`, now)} AS "resetInMs"
    `;
    const count = Number(rows[0]?.count);
    const resetInMs = Number(rows[0]?.resetInMs);
    // Fail closed: a missing or malformed row must never let requests through.
    if (!Number.isFinite(count) || !Number.isFinite(resetInMs)) {
      throw new Error("rate limit upsert returned no valid row");
    }
    return { count, resetInMs };
  }

  /**
   * Records one failure. Failures restart from zero once the window that
   * began with the first of them is over (now - window_start > windowMs);
   * reaching `limit` locks the key until now + lockoutMs (never earlier than
   * a lock it already has) and starts a new window.
   */
  async recordFailure(
    sql: Sql,
    key: string,
    policy: FailurePolicy,
    nowMs?: number,
  ): Promise<void> {
    const f = failureUpsert(sql, key, policy, nowMs);
    await sql`${f.insert} ON CONFLICT (key) DO UPDATE SET ${f.set}`;
  }

  /**
   * Reserves one attempt before it is verified (2FA codes, kiosk PINs): the
   * same upsert as `recordFailure`, refused while the key is locked. The
   * attempt that reaches `limit` is still allowed and locks the key, so at
   * most `limit` attempts are ever verified per window, also under
   * concurrency across replicas. A successful attempt `remove`s the key, or
   * `release`s its reservation when the key is a shared budget.
   */
  async reserveAttempt(
    sql: Sql,
    key: string,
    policy: FailurePolicy,
    nowMs?: number,
  ): Promise<AttemptReservation> {
    const f = failureUpsert(sql, key, policy, nowMs);
    // The outer SELECT reads the snapshot from before the upsert: when it is
    // refused, that is the lock that refused it.
    // An attempt that reaches the limit leaves count = 0 and returns the lock
    // it set, in exact epoch microseconds (a JS Date would drop them).
    const rows = await sql<
      {
        allowed: boolean;
        lockedMs: number | null;
        lockToken: string | null;
      }[]
    >`
      WITH up AS (
        ${f.insert} ON CONFLICT (key) DO UPDATE SET ${f.set}
        WHERE b.locked_until IS NULL OR b.locked_until <= ${f.now}
        RETURNING CASE WHEN count = 0 THEN ${lockTokenOf(sql, sql`locked_until`)}
                  END AS token
      )
      SELECT EXISTS (SELECT 1 FROM up) AS allowed,
        (SELECT token FROM up) AS "lockToken",
        (SELECT ${remainingMs(sql, sql`locked_until`, f.now)}
           FROM rate_limit_buckets WHERE key = ${key}) AS "lockedMs"
    `;
    const row = rows[0];
    if (!row) throw new Error("rate limit reservation returned no row");
    if (row.allowed) {
      return row.lockToken
        ? { allowed: true, lockToken: row.lockToken }
        : { allowed: true };
    }
    // A lock committed after this statement's snapshot reads as 0: still
    // refused, with a minimal Retry-After.
    return { allowed: false, lockedMs: Math.max(Number(row.lockedMs) || 0, 1) };
  }

  /** Ms until the last of `keys` to unlock is unlocked; 0 when none is locked. */
  async lockedForMs(
    sql: Sql,
    keys: readonly string[],
    nowMs?: number,
  ): Promise<number> {
    if (keys.length === 0) return 0;
    const now = clock(sql, nowMs);
    const rows = await sql<{ ms: number | null }[]>`
      SELECT max(${remainingMs(sql, sql`locked_until`, now)}) AS ms
      FROM rate_limit_buckets
      WHERE key = ANY(${[...keys]}::text[]) AND locked_until > ${now}
    `;
    return Number(rows[0]?.ms) || 0;
  }

  /**
   * Gives back one reserved attempt that turned out not to be a failure (a
   * correct PIN on a shared per-IP budget, or an attempt refused elsewhere).
   * It decrements rather than deletes, so a success cannot wipe the failures
   * other attempts recorded. When `lockToken` is the lock this reservation set
   * (still the row's lock), the lock is lifted and the count goes back to
   * `limit - 1`: the next failure locks again. Any other lock is kept. A
   * missing row (swept or reset) is a no-op.
   *
   * If the failure window restarted between reserve and release, the
   * decrement removes one failure from the new window: at most one per
   * successful attempt, so it cannot be used to gain guesses.
   */
  async release(
    sql: Sql,
    key: string,
    policy: Pick<FailurePolicy, "limit">,
    lockToken?: string,
  ): Promise<void> {
    const own =
      lockToken === undefined
        ? sql`false`
        : sql`(b.locked_until IS NOT NULL
               AND ${lockTokenOf(sql, sql`b.locked_until`)} = ${lockToken})`;
    await sql`
      UPDATE rate_limit_buckets AS b SET
        count = CASE WHEN ${own} THEN ${Math.max(policy.limit - 1, 0)}::int
                     ELSE GREATEST(b.count - 1, 0) END,
        locked_until = CASE WHEN ${own} THEN NULL ELSE b.locked_until END
      WHERE b.key = ${key}
    `;
  }

  /** Forgets a key (a successful attempt clears its failures). */
  async remove(sql: Sql, key: string): Promise<void> {
    await sql`DELETE FROM rate_limit_buckets WHERE key = ${key}`;
  }

  /**
   * Deletes expired buckets in batches until a batch comes back short or the
   * time budget is spent, so cleanup keeps up with many distinct clients.
   * The outer condition is re-checked on rows a concurrent upsert just
   * restarted, so a fresh window or lockout is never swept.
   */
  async deleteExpired(sql: Sql, options: SweepOptions = {}): Promise<number> {
    const batch = options.batch ?? 1000;
    const budgetMs = options.budgetMs ?? 2000;
    const now = clock(sql, options.nowMs);
    const started = Date.now();
    let total = 0;
    for (;;) {
      const result = await sql`
        DELETE FROM rate_limit_buckets
        WHERE expires_at < ${now} AND key IN (
          SELECT key FROM rate_limit_buckets
          WHERE expires_at < ${now}
          LIMIT ${batch}::int
          FOR UPDATE SKIP LOCKED
        )
      `;
      const deleted = Number(result.count) || 0;
      total += deleted;
      if (deleted < batch || Date.now() - started >= budgetMs) {
        return total;
      }
    }
  }
}

function clock(sql: Sql, nowMs: number | undefined): Fragment {
  return nowMs === undefined
    ? sql`statement_timestamp()`
    : sql`${new Date(nowMs)}::timestamptz`;
}

function plus(sql: Sql, t: Fragment, ms: number): Fragment {
  return sql`(${t} + ${ms}::double precision * interval '1 millisecond')`;
}

/** A lock's end as exact epoch microseconds, in text. */
function lockTokenOf(sql: Sql, column: Fragment): Fragment {
  return sql`(extract(epoch FROM ${column}) * 1000000)::bigint::text`;
}

function remainingMs(sql: Sql, column: Fragment, now: Fragment): Fragment {
  return sql`GREATEST(0, extract(epoch FROM (${column} - ${now})) * 1000)::float8`;
}

/** The INSERT and ON CONFLICT SET of one failure (or reserved attempt). */
function failureUpsert(
  sql: Sql,
  key: string,
  policy: FailurePolicy,
  nowMs: number | undefined,
) {
  const now = clock(sql, nowMs);
  const stale = plus(sql, now, -policy.windowMs);
  const windowEnd = plus(sql, now, policy.windowMs);
  const lockEnd = plus(sql, now, policy.lockoutMs);
  const lockExpiry = plus(
    sql,
    now,
    Math.max(policy.windowMs, policy.lockoutMs),
  );
  const lockNow = policy.limit <= 1;
  // Failures in the current window including this one. A new window never
  // clears or shortens a live lock (a lockout may outlast the window), and
  // expires_at never falls before locked_until, so the sweep cannot delete a
  // live lockout. GREATEST ignores a NULL locked_until.
  const n = sql`(CASE WHEN b.window_start < ${stale} THEN 0 ELSE b.count END) + 1`;
  const reached = sql`${n} >= ${policy.limit}::int`;
  const fresh = sql`b.window_start < ${stale}`;
  const insert = sql`
    INSERT INTO rate_limit_buckets AS b (key, window_start, count, locked_until, expires_at)
    VALUES (
      ${key}, ${now}, ${lockNow ? 0 : 1},
      ${lockNow ? lockEnd : sql`NULL::timestamptz`},
      ${lockNow ? lockExpiry : windowEnd}
    )`;
  const set = sql`
    count = CASE WHEN ${reached} THEN 0 ELSE ${n} END,
    window_start = CASE WHEN ${reached} OR ${fresh} THEN ${now} ELSE b.window_start END,
    locked_until = CASE WHEN ${reached} THEN GREATEST(b.locked_until, ${lockEnd})
                        ELSE b.locked_until END,
    expires_at = CASE WHEN ${reached} THEN GREATEST(b.locked_until, ${lockExpiry})
                      WHEN ${fresh} THEN GREATEST(b.locked_until, ${windowEnd})
                      ELSE b.expires_at END`;
  return { now, insert, set };
}
