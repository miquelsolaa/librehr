import type { RateLimitStore } from "./rate-limit-store.js";

export interface FailureLockoutOptions {
  /** Bucket namespace, unique per lockout ("auth.2fa"). */
  name: string;
  store: RateLimitStore;
  failureWindowMs: number;
  lockoutMs: number;
}

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

  /** Clears the failures of a key after a successful attempt. */
  reset(key: string): Promise<void> {
    return this.options.store.reset(this.key(key));
  }
}
