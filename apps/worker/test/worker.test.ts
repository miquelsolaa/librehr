import { describe, it, expect, vi } from "vitest";
import { NotImplementedError } from "../src/lib/job-errors.js";
import {
  handleEmailSend,
  type EmailJobPayload,
  type MailSender,
} from "../src/queues/email.send.js";
import { handleTimeCloseDay } from "../src/queues/time.close-day.js";
import { handleRetentionEnforce } from "../src/queues/retention.enforce.js";
import { handleAuditVerifyChain } from "../src/queues/audit.verify-chain.js";

class MockMailSender implements MailSender {
  public sentMessages: Array<{ to: string; subject: string; html: string }> =
    [];

  async sendMail(msg: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    this.sentMessages.push(msg);
  }
}

describe("Worker Queue Handlers", () => {
  it("processes email.send invite template and delivers to MailSender", async () => {
    const mailer = new MockMailSender();
    const payload: EmailJobPayload = {
      to: "new.hire@example.cat",
      template: "invite",
      props: {
        orgName: "Acme Serveis",
        inviteUrl: "https://librehr.local/invite/12345",
        locale: "ca",
      },
      idempotencyKey: "invite:new.hire@example.cat:2026-11-01",
    };

    const res = await handleEmailSend({ id: "job-1", data: payload }, mailer);
    expect(res.success).toBe(true);

    expect(mailer.sentMessages.length).toBe(1);
    const msg = mailer.sentMessages[0]!;
    expect(msg.to).toBe("new.hire@example.cat");
    expect(msg.subject).toContain("Acme Serveis");
    expect(msg.html).toContain("https://librehr.local/invite/12345");
  });

  it("processes password-reset template", async () => {
    const mailer = new MockMailSender();
    const payload: EmailJobPayload = {
      to: "reset.user@example.com",
      template: "password-reset",
      props: {
        resetUrl: "https://librehr.local/reset/token99",
        locale: "es",
      },
      idempotencyKey: "reset:reset.user@example.com:2026-11-01",
    };

    const res = await handleEmailSend({ id: "job-3", data: payload }, mailer);
    expect(res.success).toBe(true);
    expect(mailer.sentMessages.length).toBe(1);
    expect(mailer.sentMessages[0]?.html).toContain(
      "Reset your LibreHR password",
    );
  });

  it("fails time.close-day loudly and logs TIM-003", async () => {
    const warn = vi.fn();
    const err = await handleTimeCloseDay(
      {
        id: "j-close",
        data: { organizationId: "org-1", closeDate: "2026-11-01" },
      },
      { warn },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotImplementedError);
    expect(String(err)).toContain("TIM-003");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ requirement: "TIM-003", jobId: "j-close" }),
    );
  });

  it("fails retention.enforce loudly and logs ADM-005", async () => {
    const warn = vi.fn();
    const err = await handleRetentionEnforce(
      {
        id: "j-retention",
        data: { organizationId: "org-1", runDate: "2026-11-01" },
      },
      { warn },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotImplementedError);
    expect(String(err)).toContain("ADM-005");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ requirement: "ADM-005", jobId: "j-retention" }),
    );
  });

  it("rejects an invalid audit.verify-chain payload before touching the database", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(
      handleAuditVerifyChain(
        { id: "j-audit", data: { organizationId: "org-1", runDate: "x" } },
        {
          sql: {} as never,
          timeChainKey: "test_time_chain_key_with_at_least_32_chars",
          logger,
        },
      ),
    ).rejects.toThrow(/invalid audit.verify-chain payload/);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
