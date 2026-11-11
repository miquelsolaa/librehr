import type { SendOptions } from "pg-boss";
import {
  EmailJobPayloadSchema,
  emailSingletonKey,
} from "../queues/email.send.js";
import {
  LeaveAccruePayloadSchema,
  leaveAccrueSingletonKey,
} from "../queues/leave.accrue.js";
import {
  TimeCloseDayPayloadSchema,
  timeCloseDaySingletonKey,
} from "../queues/time.close-day.js";
import {
  RetentionEnforcePayloadSchema,
  retentionEnforceSingletonKey,
} from "../queues/retention.enforce.js";
import {
  AuditVerifyChainPayloadSchema,
  auditVerifyChainSingletonKey,
} from "../queues/audit.verify-chain.js";
import { parsePayload } from "./payload.js";

export { AuditVerifyChainPayloadSchema };

/**
 * Every queue, its payload schema and its dedup key.
 *
 * Idempotency guarantee: queues are created with the `exclusive` policy, under which pg-boss
 * allows at most one job per `singletonKey` that is queued or active. That is enforced by a
 * unique index in Postgres, so it survives restarts and holds across worker processes (the old
 * in-memory Set did neither). It does not dedupe a job enqueued again after the first one has
 * completed; handlers must stay safe to re-run (at-least-once delivery).
 */
export const QUEUES = {
  "email.send": { schema: EmailJobPayloadSchema, key: emailSingletonKey },
  "leave.accrue": {
    schema: LeaveAccruePayloadSchema,
    key: leaveAccrueSingletonKey,
  },
  "time.close-day": {
    schema: TimeCloseDayPayloadSchema,
    key: timeCloseDaySingletonKey,
  },
  "retention.enforce": {
    schema: RetentionEnforcePayloadSchema,
    key: retentionEnforceSingletonKey,
  },
  "audit.verify-chain": {
    schema: AuditVerifyChainPayloadSchema,
    key: auditVerifyChainSingletonKey,
  },
} as const;

export type QueueName = keyof typeof QUEUES;
export const QUEUE_POLICY = "exclusive";

export interface JobSender {
  send(
    name: string,
    data: object,
    options: SendOptions,
  ): Promise<string | null>;
}

/**
 * Validates a payload and enqueues it with its deterministic `singletonKey`. Returns null when
 * pg-boss rejected the job as a duplicate. Any producer (worker schedules, API) should use this
 * instead of calling `boss.send` directly.
 */
export async function enqueue<Q extends QueueName>(
  boss: JobSender,
  queue: Q,
  payload: unknown,
): Promise<string | null> {
  const { schema, key } = QUEUES[queue];
  const data = parsePayload(queue, schema, payload);
  // The union of per-queue key functions is not callable with a union argument; the pairing
  // is guaranteed by QUEUES itself.
  const singletonKey = (key as (p: typeof data) => string)(data);
  return boss.send(queue, data, { singletonKey });
}
