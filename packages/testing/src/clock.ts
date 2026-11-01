import type { Clock } from "@openhr/core";

export class FakeClock implements Clock {
  private currentTime: Date;

  constructor(initial: Date = new Date("2026-11-01T09:00:00Z")) {
    this.currentTime = new Date(initial);
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  advanceByMs(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  setTime(date: Date): void {
    this.currentTime = new Date(date);
  }
}
