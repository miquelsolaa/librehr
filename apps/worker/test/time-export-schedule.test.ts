import { describe, expect, it, vi } from "vitest";
import { enqueue, QUEUES, prepareJob } from "../src/lib/enqueue.js";
import { TIME_EXPORT_EXPIRE_SECONDS } from "../src/queues/time.export.js";
import { TIME_EXPORT_STALE_MINUTES } from "../src/queues/time.export-cleanup.js";
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

  it("sends time.export with a 1-hour expiry, so a slow build is not re-driven", async () => {
    const send = vi.fn(async () => "job-id");
    const payload = {
      organizationId: "a4500000-0000-4000-8000-00000000000a",
      exportId: "b4500000-0000-4000-8000-00000000000b",
    };
    await enqueue({ send }, "time.export", payload);
    expect(TIME_EXPORT_EXPIRE_SECONDS).toBe(3600);
    expect(send).toHaveBeenCalledWith("time.export", payload, {
      expireInSeconds: 3600,
      singletonKey: `${payload.organizationId}:${payload.exportId}`,
    });
    // The stalled-run sweep waits longer than every run pg-boss may re-drive.
    expect(TIME_EXPORT_STALE_MINUTES * 60).toBeGreaterThan(
      TIME_EXPORT_EXPIRE_SECONDS * 3,
    );
    // Other queues keep pg-boss's default expiry.
    send.mockClear();
    await enqueue({ send }, "time.export.dispatch", {});
    expect(send).toHaveBeenCalledWith(
      "time.export.dispatch",
      {},
      { singletonKey: "time.export.dispatch" },
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
