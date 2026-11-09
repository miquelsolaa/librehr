import type { Logger } from "pino";
import { QUEUES, QUEUE_POLICY, type QueueName } from "./enqueue.js";

/**
 * How long job rows (and their payloads) stay in the pg-boss tables. Email payloads carry the
 * recipient address and invite/reset URLs, so these are kept short:
 * - retentionSeconds: a job still waiting (created/retry) is dropped after 7 days.
 * - deleteAfterSeconds: a finished job (completed, cancelled or failed) is deleted 3 days after
 *   it finished, which leaves operators a working window to inspect and re-drive failures.
 * Documented in docs/guides/self-hosting.md (job data retention).
 */
export const QUEUE_RETENTION = {
  retentionSeconds: 7 * 24 * 60 * 60,
  deleteAfterSeconds: 3 * 24 * 60 * 60,
} as const;

const POLICY_REMEDIATION =
  "drain and recreate the queue so it gets the expected policy; see docs/guides/upgrading.md (pg-boss queue policy)";

interface QueueInfo {
  policy?: string;
  retentionSeconds?: number;
  deleteAfterSeconds?: number;
}

/** The subset of PgBoss used to set up queues, so it can be faked in tests. */
export interface QueueAdmin {
  getQueue(name: string): Promise<QueueInfo | null>;
  createQueue(
    name: string,
    options: { policy: string } & typeof QUEUE_RETENTION,
  ): Promise<void>;
  updateQueue(name: string, options: typeof QUEUE_RETENTION): Promise<void>;
}

/**
 * Creates missing queues with {@link QUEUE_POLICY} and {@link QUEUE_RETENTION}.
 *
 * pg-boss never changes the policy of an existing queue, so a queue created earlier with the
 * `standard` policy keeps it and its `singletonKey` no longer dedupes jobs. That cannot be
 * fixed in place without losing jobs, so it is reported with a structured warning instead.
 * Retention can be changed in place, so existing queues are brought in line.
 */
export async function ensureQueues(
  boss: QueueAdmin,
  logger: Pick<Logger, "warn">,
): Promise<void> {
  for (const queue of Object.keys(QUEUES) as QueueName[]) {
    const existing = await boss.getQueue(queue);
    if (!existing) {
      await boss.createQueue(queue, {
        policy: QUEUE_POLICY,
        ...QUEUE_RETENTION,
      });
      continue;
    }
    const actualPolicy = existing.policy ?? "standard";
    if (actualPolicy !== QUEUE_POLICY) {
      logger.warn({
        msg: "pg-boss queue has an unexpected policy: duplicate jobs are not deduplicated",
        queue,
        actualPolicy,
        expectedPolicy: QUEUE_POLICY,
        remediation: POLICY_REMEDIATION,
      });
    }
    if (
      existing.retentionSeconds !== QUEUE_RETENTION.retentionSeconds ||
      existing.deleteAfterSeconds !== QUEUE_RETENTION.deleteAfterSeconds
    ) {
      await boss.updateQueue(queue, QUEUE_RETENTION);
    }
  }
}
