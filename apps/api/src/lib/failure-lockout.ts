import type { AttemptReservation, RateLimitStore } from "./rate-limit-store.js";

export interface FailureLockoutOptions {
  /** Bucket namespace, unique per lockout ("auth.2fa"). */
  name: string;
  store: RateLimitStore;
  failureWindowMs: number;
  lockoutMs: number;
}

/**
 * How long after a lock is set it may still be lifted by the in-flight
 * attempt that set it: well above one PIN or code check, short enough that a
 * client honouring Retry-After barely waits.
 */
export const PROVISIONAL_LOCK_MS = 3_000;

/**
 * Counts failed attempts per key (a kiosk identifier, a client IP, an account) and
 * locks a key out for `lockoutMs` once it reaches its limit within
 * `failureWindowMs` (kiosk PINs: TIM-010; second factors: AUTH-003).
 *
 * State lives in the shared rate-limit store, so a lockout holds on every
 * API replica.
 */
export class FailureLockout {
  constructor(private readonly options: FailureLockoutOptions) {}

  private key(key: string): string {
    return `${this.options.name}:${key}`;
  }

  /** Milliseconds until every one of `keys` is unlocked; 0 when none is locked. */
  lockedFor(keys: readonly string[]): Promise<number> {
    return this.options.store.lockedFor(keys.map((k) => this.key(k)));
  }

  /** Records one failure against each key with its own limit. */
  recordFailure(
    keys: ReadonlyArray<{ key: string; limit: number }>,
  ): Promise<void> {
    return this.options.store.recordFailure(
      keys.map(({ key, limit }) => ({ key: this.key(key), limit })),
      {
        windowMs: this.options.failureWindowMs,
        lockoutMs: this.options.lockoutMs,
      },
    );
  }

  /**
   * Counts an attempt atomically before it is verified, refused while the
   * key is locked, so at most `limit` attempts per window are ever checked,
   * whatever the concurrency and the number of replicas. On success call
   * `reset` (a per-identifier key) or `release` (a shared budget, such as a
   * kiosk's IP); a failed attempt needs nothing more.
   */
  reserve(key: string, limit: number): Promise<AttemptReservation> {
    return this.options.store.reserveAttempt(this.key(key), {
      limit,
      windowMs: this.options.failureWindowMs,
      lockoutMs: this.options.lockoutMs,
    });
  }

  /**
   * Gives back an allowed reservation that was not a failure, without
   * clearing the failures others recorded on the key. If that reservation
   * set the key's lock, the lock is lifted; any other lock is kept. Attempts
   * refused while such a lock stood are not retried: give them
   * `retryAfterMs`, which keeps their Retry-After short.
   */
  release(
    key: string,
    limit: number,
    reservation: AttemptReservation,
  ): Promise<void> {
    const token =
      reservation.allowed && reservation.lockToken !== undefined
        ? reservation.lockToken
        : undefined;
    return this.options.store.release(this.key(key), { limit }, token);
  }

  /**
   * The Retry-After, in ms, for an attempt refused with `lockedMs` left on
   * the lock. A lock younger than `PROVISIONAL_LOCK_MS` may be one that an
   * attempt in flight set by reaching the limit and will lift on `release`
   * (a correct kiosk PIN), so it gets at most that short wait instead of the
   * full lockout; a client retrying then gets the real remaining time if the
   * lock stayed. Older locks report their full remaining time.
   *
   * @example
   * // lockoutMs 900_000: a lock set 1 s ago, and one set 5 minutes ago
   * lockout.retryAfterMs(899_000); // 2_000
   * lockout.retryAfterMs(600_000); // 600_000
   */
  retryAfterMs(lockedMs: number): number {
    const age = this.options.lockoutMs - lockedMs;
    return age < PROVISIONAL_LOCK_MS
      ? Math.min(lockedMs, PROVISIONAL_LOCK_MS - Math.max(age, 0))
      : lockedMs;
  }

  /** Clears the failures of a key after a successful attempt. */
  reset(key: string): Promise<void> {
    return this.options.store.reset(this.key(key));
  }
}
