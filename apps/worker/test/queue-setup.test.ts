import { describe, it, expect, vi } from "vitest";
import { QUEUES, QUEUE_POLICY } from "../src/lib/enqueue.js";
import {
  QUEUE_RETENTION,
  ensureQueues,
  type QueueAdmin,
} from "../src/lib/queue-setup.js";

type Existing = Record<string, { policy?: string } & typeof QUEUE_RETENTION>;

function fakeBoss(existing: Existing) {
  const admin: QueueAdmin = {
    getQueue: vi.fn(async (name: string) => {
      const q = existing[name];
      return q ? { name, ...q } : null;
    }),
    createQueue: vi.fn(async () => undefined),
    updateQueue: vi.fn(async () => undefined),
  };
  return admin;
}

const queueNames = Object.keys(QUEUES);

describe("ensureQueues", () => {
  it("creates missing queues with the expected policy and retention", async () => {
    const boss = fakeBoss({});
    const warn = vi.fn();
    await ensureQueues(boss, { warn });
    expect(boss.createQueue).toHaveBeenCalledTimes(queueNames.length);
    for (const name of queueNames) {
      expect(boss.createQueue).toHaveBeenCalledWith(name, {
        policy: QUEUE_POLICY,
        ...QUEUE_RETENTION,
      });
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns, naming the queue and the remediation, when an existing queue has another policy", async () => {
    const existing: Existing = {};
    for (const name of queueNames) {
      existing[name] = { policy: QUEUE_POLICY, ...QUEUE_RETENTION };
    }
    existing["email.send"] = { policy: "standard", ...QUEUE_RETENTION };
    const boss = fakeBoss(existing);
    const warn = vi.fn();

    await ensureQueues(boss, { warn });

    expect(boss.createQueue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: "email.send",
        actualPolicy: "standard",
        expectedPolicy: QUEUE_POLICY,
        remediation: expect.stringContaining("upgrading.md"),
      }),
    );
  });

  it("applies the retention settings to existing queues that differ", async () => {
    const existing: Existing = {};
    for (const name of queueNames) {
      existing[name] = { policy: QUEUE_POLICY, ...QUEUE_RETENTION };
    }
    existing["leave.accrue"] = {
      policy: QUEUE_POLICY,
      retentionSeconds: 1_209_600,
      deleteAfterSeconds: 604_800,
    };
    const boss = fakeBoss(existing);

    await ensureQueues(boss, { warn: vi.fn() });

    expect(boss.updateQueue).toHaveBeenCalledTimes(1);
    expect(boss.updateQueue).toHaveBeenCalledWith(
      "leave.accrue",
      QUEUE_RETENTION,
    );
  });
});
