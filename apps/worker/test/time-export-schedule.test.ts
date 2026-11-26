import { describe, expect, it, vi } from "vitest";
import { QUEUES, prepareJob } from "../src/lib/enqueue.js";
import {
  configureTimeExportSchedules,
  TIME_EXPORT_CLEANUP_QUEUE,
  TIME_EXPORT_DISPATCH_QUEUE,
} from "../src/queues/time.export-dispatch.js";

describe("time export schedules (TIM-006)", () => {
  it("installs the minute dispatch and the hourly cleanup on their own queues", async () => {
    const schedule = vi.fn(async () => undefined);
    await configureTimeExportSchedules({ schedule });
    expect(schedule.mock.calls).toEqual([
      [
        TIME_EXPORT_DISPATCH_QUEUE,
        "* * * * *",
        {},
        { tz: "UTC", singletonKey: TIME_EXPORT_DISPATCH_QUEUE, missed: "once" },
      ],
      [
        TIME_EXPORT_CLEANUP_QUEUE,
        "7 * * * *",
        {},
        { tz: "UTC", singletonKey: TIME_EXPORT_CLEANUP_QUEUE, missed: "once" },
      ],
    ]);
    expect(Object.keys(QUEUES)).toEqual(
      expect.arrayContaining([
        "time.export",
        TIME_EXPORT_DISPATCH_QUEUE,
        TIME_EXPORT_CLEANUP_QUEUE,
      ]),
    );
  });

  it("keys a time.export job by organization and export", () => {
    const payload = {
      organizationId: "a4500000-0000-4000-8000-00000000000a",
      exportId: "b4500000-0000-4000-8000-00000000000b",
    };
    expect(prepareJob("time.export", payload).singletonKey).toBe(
      `${payload.organizationId}:${payload.exportId}`,
    );
  });
});
