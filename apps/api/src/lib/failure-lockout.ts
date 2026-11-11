interface FailureRecord {
  failures: number;
  windowStartedAt: number;
  lockedUntil: number;
}

export interface FailureLockoutOptions {
  failureWindowMs: number;
  lockoutMs: number;
}

/** Keep the in-memory map bounded; expired entries are pruned past this size. */
const PRUNE_THRESHOLD = 10_000;

/**
 * Counts failed attempts per key (a kiosk identifier, a client IP, an account) and
 * locks a key out for `lockoutMs` once it reaches its limit within
 * `failureWindowMs` (kiosk PINs: TIM-010; second factors: AUTH-003).
 *
 * State is per process, like the request rate limiter: with several API
 * instances each one counts separately, so the effective limit is N per
 * instance.
 */
export class FailureLockout {
  private readonly records = new Map<string, FailureRecord>();

  constructor(
    private readonly options: FailureLockoutOptions,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds until the first of `keys` is unlocked, or 0 when none is locked. */
  lockedFor(keys: readonly string[]): number {
    const now = this.now();
    let remaining = 0;
    for (const key of keys) {
      const record = this.records.get(key);
      if (record && record.lockedUntil > now) {
        remaining = Math.max(remaining, record.lockedUntil - now);
      }
    }
    return remaining;
  }

  /** Records one failure against each key with its own limit. */
  recordFailure(keys: ReadonlyArray<{ key: string; limit: number }>): void {
    const now = this.now();
    this.prune(now);
    for (const { key, limit } of keys) {
      let record = this.records.get(key);
      if (
        !record ||
        now - record.windowStartedAt > this.options.failureWindowMs
      ) {
        record = { failures: 0, windowStartedAt: now, lockedUntil: 0 };
        this.records.set(key, record);
      }
      record.failures++;
      if (record.failures >= limit) {
        record.lockedUntil = now + this.options.lockoutMs;
        record.failures = 0;
        record.windowStartedAt = now;
      }
    }
  }

  /** Clears the failures of a key after a successful attempt. */
  reset(key: string): void {
    this.records.delete(key);
  }

  private prune(now: number): void {
    if (this.records.size < PRUNE_THRESHOLD) return;
    for (const [key, record] of this.records) {
      if (
        record.lockedUntil <= now &&
        now - record.windowStartedAt > this.options.failureWindowMs
      ) {
        this.records.delete(key);
      }
    }
  }
}
