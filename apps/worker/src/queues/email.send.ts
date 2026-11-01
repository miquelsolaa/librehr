import * as React from "react";
import { render } from "@react-email/render";
import { InviteEmail, PasswordResetEmail } from "@openhr/emails";
import { defaultIdempotency } from "../lib/idempotency.js";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string | undefined;
}

export interface EmailJobPayload {
  to: string;
  template: "invite" | "password-reset";
  props: {
    inviteUrl?: string;
    resetUrl?: string;
    orgName?: string;
    locale?: string;
  };
  idempotencyKey: string;
}

export interface MailSender {
  sendMail(msg: MailMessage): Promise<void>;
}

export async function handleEmailSend(
  job: { id: string; data: EmailJobPayload },
  mailer: MailSender,
): Promise<{ success: boolean; skipped?: boolean }> {
  const { to, template, props, idempotencyKey } = job.data;

  // Idempotency check: prevent duplicate email dispatches
  const canProceed = await defaultIdempotency.checkAndMark(idempotencyKey);
  if (!canProceed) {
    return { success: true, skipped: true };
  }

  let html = "";
  let subject = "";

  if (template === "invite") {
    subject = `Invitation to join ${props.orgName ?? "OpenHR"}`;
    const el = React.createElement(InviteEmail, {
      inviteUrl: props.inviteUrl ?? "",
      orgName: props.orgName ?? "OpenHR",
      ...(props.locale ? { locale: props.locale } : {}),
    });
    html = await render(el);
  } else if (template === "password-reset") {
    subject = "Reset your OpenHR password";
    const el = React.createElement(PasswordResetEmail, {
      resetUrl: props.resetUrl ?? "",
      ...(props.locale ? { locale: props.locale } : {}),
    });
    html = await render(el);
  }

  await mailer.sendMail({
    to,
    subject,
    html,
  });

  return { success: true };
}
