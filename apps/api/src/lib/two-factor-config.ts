/**
 * Two-factor authentication knobs (AUTH-003). Instance-wide configuration
 * with named defaults, overridable through `createApp({ twoFactor })`.
 */
export interface TwoFactorConfig {
  /** How long a /2fa/setup secret can be confirmed with /2fa/enable. */
  pendingSetupTtlMs: number;
  /** Recovery codes generated per setup (single use, stored hashed). */
  recoveryCodeCount: number;
  /**
   * Per-account lockout of second-factor checks (sign-in with a code,
   * /2fa/verify, /2fa/disable), counted per user and independent of the
   * client IP, so rotating IPs cannot multiply the guesses on one account.
   * Like the request rate limiter, the counters are per API process.
   */
  lockout: {
    /** Failed second-factor attempts per account within the window. */
    maxFailures: number;
    /** Window in which failures are counted. */
    failureWindowMs: number;
    /** How long the account's second-factor checks stay locked. */
    lockoutMs: number;
  };
}

export const DEFAULT_TWO_FACTOR_CONFIG: TwoFactorConfig = {
  pendingSetupTtlMs: 10 * 60 * 1000,
  recoveryCodeCount: 8,
  // About 40 guesses per hour against a 6-digit code (3 steps accepted per
  // guess): roughly a 0.3% chance per day for a sustained attack, while a
  // user who mistypes a few times is not locked out.
  lockout: {
    maxFailures: 10,
    failureWindowMs: 15 * 60 * 1000,
    lockoutMs: 15 * 60 * 1000,
  },
};

export type TwoFactorConfigInput = Partial<Omit<TwoFactorConfig, "lockout">> & {
  lockout?: Partial<TwoFactorConfig["lockout"]> | undefined;
};

export function resolveTwoFactorConfig(
  input: TwoFactorConfigInput | undefined,
): TwoFactorConfig {
  return {
    pendingSetupTtlMs:
      input?.pendingSetupTtlMs ?? DEFAULT_TWO_FACTOR_CONFIG.pendingSetupTtlMs,
    recoveryCodeCount:
      input?.recoveryCodeCount ?? DEFAULT_TWO_FACTOR_CONFIG.recoveryCodeCount,
    lockout: { ...DEFAULT_TWO_FACTOR_CONFIG.lockout, ...input?.lockout },
  };
}
