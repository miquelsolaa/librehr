/**
 * Two-factor authentication knobs (AUTH-003). Instance-wide configuration
 * with named defaults, overridable through `createApp({ twoFactor })`.
 */
export interface TwoFactorConfig {
  /** How long a /2fa/setup secret can be confirmed with /2fa/enable. */
  pendingSetupTtlMs: number;
  /** Recovery codes generated per setup (single use, stored hashed). */
  recoveryCodeCount: number;
}

export const DEFAULT_TWO_FACTOR_CONFIG: TwoFactorConfig = {
  pendingSetupTtlMs: 10 * 60 * 1000,
  recoveryCodeCount: 8,
};

export type TwoFactorConfigInput = Partial<TwoFactorConfig>;

export function resolveTwoFactorConfig(
  input: TwoFactorConfigInput | undefined,
): TwoFactorConfig {
  return {
    pendingSetupTtlMs:
      input?.pendingSetupTtlMs ?? DEFAULT_TWO_FACTOR_CONFIG.pendingSetupTtlMs,
    recoveryCodeCount:
      input?.recoveryCodeCount ?? DEFAULT_TWO_FACTOR_CONFIG.recoveryCodeCount,
  };
}
