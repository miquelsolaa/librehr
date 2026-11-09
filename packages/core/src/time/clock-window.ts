/**
 * Whether a client-supplied clock time is close enough to the server clock to
 * be recorded directly (TIM-002, TIM-003). Anything further away is a
 * backdated or future-dated punch and must go through the correction
 * workflow, where a manager approves it and the original stays visible.
 *
 * The tolerance is policy configuration, passed in by the caller. The bound is
 * inclusive.
 *
 * @example
 * const now = new Date("2026-11-02T08:00:00Z");
 * isWithinClockWindow(new Date("2026-11-02T07:59:30Z"), now, 120_000); // true
 * isWithinClockWindow(new Date("2026-11-02T07:50:00Z"), now, 120_000); // false
 */
export function isWithinClockWindow(
  occurredAt: Date,
  serverNow: Date,
  toleranceMs: number,
): boolean {
  const skew = Math.abs(occurredAt.getTime() - serverNow.getTime());
  return Number.isFinite(skew) && skew <= toleranceMs;
}
