import { describe, it, expect } from "vitest";
import {
  handleEmailSend,
  type EmailJobPayload,
  type MailSender,
} from "../src/queues/email.send.js";
import { handleLeaveAccrue } from "../src/queues/leave.accrue.js";
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
        inviteUrl: "https://openhr.local/invite/12345",
        locale: "ca",
      },
      idempotencyKey: "invite:new.hire@example.cat:2026-11-01",
    };

    const res = await handleEmailSend({ id: "job-1", data: payload }, mailer);
    expect(res.success).toBe(true);
    expect(res.skipped).toBeUndefined();

    expect(mailer.sentMessages.length).toBe(1);
    const msg = mailer.sentMessages[0]!;
    expect(msg.to).toBe("new.hire@example.cat");
    expect(msg.subject).toContain("Acme Serveis");
    expect(msg.html).toContain("https://openhr.local/invite/12345");
  });

  it("skips duplicate email.send job with identical idempotencyKey", async () => {
    const mailer = new MockMailSender();
    const payload: EmailJobPayload = {
      to: "new.hire@example.cat",
      template: "invite",
      props: { inviteUrl: "https://openhr.local/invite/12345" },
      idempotencyKey: "invite:new.hire@example.cat:2026-11-01", // Already executed
    };

    const res = await handleEmailSend({ id: "job-2", data: payload }, mailer);
    expect(res.success).toBe(true);
    expect(res.skipped).toBe(true);
    expect(mailer.sentMessages.length).toBe(0);
  });

  it("processes password-reset template", async () => {
    const mailer = new MockMailSender();
    const payload: EmailJobPayload = {
      to: "reset.user@example.com",
      template: "password-reset",
      props: {
        resetUrl: "https://openhr.local/reset/token99",
        locale: "es",
      },
      idempotencyKey: "reset:reset.user@example.com:2026-11-01",
    };

    const res = await handleEmailSend({ id: "job-3", data: payload }, mailer);
    expect(res.success).toBe(true);
    expect(mailer.sentMessages.length).toBe(1);
    expect(mailer.sentMessages[0]?.html).toContain(
      "Reset your OpenHR password",
    );
  });

  it("executes stub handlers with expected TODO requirement metadata", async () => {
    const accrueRes = await handleLeaveAccrue({
      data: { organizationId: "org-1", runDate: "2026-11-01" },
    });
    expect(accrueRes.stub).toBe("LEA-002");

    const closeRes = await handleTimeCloseDay({
      data: { organizationId: "org-1", closeDate: "2026-11-01" },
    });
    expect(closeRes.stub).toBe("TIM-003");

    const retentionRes = await handleRetentionEnforce({
      data: { organizationId: "org-1", runDate: "2026-11-01" },
    });
    expect(retentionRes.stub).toBe("ADM-005");

    const auditRes = await handleAuditVerifyChain({
      data: { organizationId: "org-1", runDate: "2026-11-01" },
    });
    expect(auditRes.stub).toBe("TIM-002");
  });
});
