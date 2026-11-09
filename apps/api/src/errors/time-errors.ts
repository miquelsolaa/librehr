import { AppError } from "./app-error.js";

/**
 * RFC 9457 problem type for a clock time outside the server tolerance. A
 * relative URI reference, resolved against the API origin (RFC 9457 3.1.1).
 */
export const TIME_EVENT_OUT_OF_WINDOW_TYPE =
  "/problems/time-event-out-of-window";

/**
 * A direct clock event whose `occurredAt` is too far from the server clock
 * (TIM-002). Backdated or future-dated punches must be filed as corrections,
 * which a manager approves while the original record stays visible (TIM-003).
 */
export class TimeEventOutOfWindowError extends AppError {
  constructor(toleranceMs: number) {
    const seconds = Math.round(toleranceMs / 1000);
    super({
      status: 422,
      type: TIME_EVENT_OUT_OF_WINDOW_TYPE,
      title: "Time event out of window",
      code: "TIME_EVENT_OUT_OF_WINDOW",
      detail: `occurredAt must be within ${seconds} seconds of the server time. To record a different time, submit a correction request (POST /v1/time/corrections) for approval.`,
    });
  }
}
