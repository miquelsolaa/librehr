import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { handleEmailSend } from "../src/queues/email.send.js";
import { handleLeaveAccrue } from "../src/queues/leave.accrue.js";
import { processBatch } from "../src/lib/process-batch.js";
import { enqueue } from "../src/lib/enqueue.js";
import {
  InvalidPayloadError,
  NotImplementedError,
  SmtpNotConfiguredError,
} from "../src/lib/job-errors.js";

const silent = pino({ level: "silent" });

function job<T>(id: string, data: T) {
  return { id, data };
}

describe("email.send without SMTP", () => {
  it("throws instead of reporting success", async () => {
    await expect(
      handleEmailSend(
        job("j1", {
          to: "a@example.com",
          template: "password-reset",
          props: { resetUrl: "https://librehr.local/reset/x" },
          idempotencyKey: "reset:1",
        }),
        null,
      ),
    ).rejects.toBeInstanceOf(SmtpNotConfiguredError);
  });
});

describe("payload validation", () => {
  it("rejects an invalid email payload without echoing its values", async () => {
    const send = vi.fn();
    const err = await handleEmailSend(
      job("j1", { to: "not-an-email", template: "bogus-template" }),
      { sendMail: send },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidPayloadError);
    expect(String(err)).not.toContain("not-an-email");
    expect(String(err)).not.toContain("bogus-template");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an invalid accrual payload", async () => {
    await expect(
      handleLeaveAccrue(job("j1", { organizationId: 7, runDate: "nope" }), {
        sql: vi.fn() as never,
        logger: silent,
      }),
    ).rejects.toBeInstanceOf(InvalidPayloadError);
  });

  it("refuses to enqueue an invalid payload", async () => {
    const boss = { send: vi.fn() };
    await expect(
      enqueue(boss, "time.close-day", { organizationId: "org-1" }),
    ).rejects.toBeInstanceOf(InvalidPayloadError);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("enqueues with a deterministic singletonKey", async () => {
    const boss = { send: vi.fn().mockResolvedValue("id-1") };
    await enqueue(boss, "time.close-day", {
      organizationId: "org-1",
      closeDate: "2026-11-01",
    });
    expect(boss.send).toHaveBeenCalledWith(
      "time.close-day",
      { organizationId: "org-1", closeDate: "2026-11-01" },
      { singletonKey: "org-1:2026-11-01" },
    );
  });
});

describe("leave.accrue", () => {
  it("rejects policy values in the payload: they are read from leave_policies", async () => {
    const sql = vi.fn();
    const err = await handleLeaveAccrue(
      job("j1", {
        organizationId: "00000000-0000-4000-8000-000000000001",
        runDate: "2026-11-01",
        accrualMethod: "monthly",
        annualAllowanceDays: 24,
      }),
      { sql: sql as never, logger: silent },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidPayloadError);
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("processBatch", () => {
  it("processes every job and isolates a failing one", async () => {
    const seen: string[] = [];
    const results = await processBatch(
      "test.queue",
      [job("a", 1), job("b", 2), job("c", 3)],
      async (j) => {
        seen.push(j.id);
        if (j.id === "b") throw new Error("boom for someone@example.com");
        return { ok: j.data };
      },
      silent,
    );
    expect(seen).toEqual(["a", "b", "c"]);
    expect(results).toEqual([
      { id: "a", status: "completed", output: { ok: 1 } },
      {
        id: "b",
        status: "failed",
        output: { error: { name: "Error", message: "unexpected error" } },
      },
      { id: "c", status: "completed", output: { ok: 3 } },
    ]);
  });

  it("dead-letters non-retryable errors and keeps their safe message", async () => {
    const results = await processBatch(
      "test.queue",
      [job("a", null)],
      async () => {
        throw new NotImplementedError("ledger write deferred (LEA-002)");
      },
      silent,
    );
    expect(results[0]).toEqual({
      id: "a",
      status: "deadletter",
      output: {
        error: {
          name: "NotImplementedError",
          message: "not implemented: ledger write deferred (LEA-002)",
        },
      },
    });
  });

  it("retries (fails, not dead-letters) when SMTP is not configured", async () => {
    const results = await processBatch(
      "email.send",
      [job("a", null)],
      async () => {
        throw new SmtpNotConfiguredError();
      },
      silent,
    );
    expect(results[0]?.status).toBe("failed");
  });
});
