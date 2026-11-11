/**
 * Time-tracking policy knobs (TIM-002, TIM-003, TIM-010). Organizations have
 * no time policy table yet, so these are instance-wide configuration with
 * named defaults, overridable through `createApp({ timeTracking })`.
 */
export interface TimeTrackingConfig {
  /**
   * Largest allowed distance between a client-supplied `occurredAt` on a
   * direct clock event and the server clock. Anything further away must be
   * filed as a correction (TIM-003).
   */
  clockToleranceMs: number;
  kiosk: {
    /** Failed PIN attempts per identifier before it is locked out. */
    maxFailuresPerIdentifier: number;
    /**
     * Failed PIN attempts per client IP before the IP is locked out. Kept well
     * above the per-identifier limit on purpose: a shared kiosk is one IP for
     * a whole site, so this only stops one device from guessing across many
     * identifiers, at the cost that a burst of failures from that device
     * blocks every employee there until `lockoutMs` passes. The client IP is
     * resolved with TRUST_PROXY (lib/client-ip.ts), so X-Forwarded-For is only
     * believed for trusted proxy hops.
     */
    maxFailuresPerIp: number;
    /** Window in which failures are counted. */
    failureWindowMs: number;
    /** How long a lockout lasts. */
    lockoutMs: number;
    /** Request rate limit per client IP (all attempts, not only failures). */
    ipRateLimit: { windowMs: number; max: number };
  };
}

export const DEFAULT_TIME_TRACKING_CONFIG: TimeTrackingConfig = {
  clockToleranceMs: 2 * 60 * 1000,
  kiosk: {
    maxFailuresPerIdentifier: 5,
    // A shared kiosk serves a whole site; allow for typos across many people.
    maxFailuresPerIp: 20,
    failureWindowMs: 15 * 60 * 1000,
    lockoutMs: 15 * 60 * 1000,
    // A shift change can bring dozens of people to one device in a minute.
    ipRateLimit: { windowMs: 60 * 1000, max: 120 },
  },
};

export type TimeTrackingConfigInput = Partial<
  Omit<TimeTrackingConfig, "kiosk">
> & { kiosk?: Partial<TimeTrackingConfig["kiosk"]> | undefined };

export function resolveTimeTrackingConfig(
  input: TimeTrackingConfigInput | undefined,
): TimeTrackingConfig {
  return {
    clockToleranceMs:
      input?.clockToleranceMs ?? DEFAULT_TIME_TRACKING_CONFIG.clockToleranceMs,
    kiosk: { ...DEFAULT_TIME_TRACKING_CONFIG.kiosk, ...input?.kiosk },
  };
}
