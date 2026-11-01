import { SystemClock } from "@openhr/core";
import type { ClockPort } from "../ports/clock.js";

export class SystemClockAdapter implements ClockPort {
  private clock = new SystemClock();

  now(): Date {
    return this.clock.now();
  }
}
