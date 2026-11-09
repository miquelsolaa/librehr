import * as React from "react";
import { z } from "zod";
import { render } from "@react-email/render";
import { InviteEmail, PasswordResetEmail } from "@librehr/emails";
import { SmtpNotConfiguredError } from "../lib/job-errors.js";
import { parsePayload } from "../lib/payload.js";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string | undefined;
}

export interface MailSender {
  sendMail(msg: MailMessage): Promise<void>;
}

const locale = z.enum(["ca", "es", "en"]).optional();

const base = z.object({
  to: z.string().email(),
  idempotencyKey: z.string().min(1).max(200),
});

export const EmailJobPayloadSchema = z.discriminatedUnion("template", [
  base.extend({
    template: z.literal("invite"),
    props: z.object({
      inviteUrl: z.string().url(),
      orgName: z.string().min(1).optional(),
      locale,
    }),
  }),
  base.extend({
    template: z.literal("password-reset"),
    props: z.object({ resetUrl: z.string().url(), locale }),
  }),
]);

export type EmailJobPayload = z.input<typeof EmailJobPayloadSchema>;

/**
 * Enqueue-time dedup key. pg-boss enforces it on the `exclusive` queue policy, so the same
 * logical email cannot be queued twice while one is pending or running.
 */
export const emailSingletonKey = (p: z.output<typeof EmailJobPayloadSchema>) =>
  p.idempotencyKey;

/**
 * Renders and sends a transactional email. Delivery is at-least-once: if the process dies
 * after SMTP accepted the message but before pg-boss records completion, the retry resends it.
 * Without a configured mailer the job fails (and is retried) rather than reporting success.
 */
export async function handleEmailSend(
  job: { id: string; data: unknown },
  mailer: MailSender | null,
): Promise<{ success: true }> {
  const data = parsePayload("email.send", EmailJobPayloadSchema, job.data);
  if (!mailer) throw new SmtpNotConfiguredError();

  let subject: string;
  let el: React.ReactElement;
  if (data.template === "invite") {
    const orgName = data.props.orgName ?? "LibreHR";
    subject = `Invitation to join ${orgName}`;
    el = React.createElement(InviteEmail, {
      inviteUrl: data.props.inviteUrl,
      orgName,
      ...(data.props.locale ? { locale: data.props.locale } : {}),
    });
  } else {
    subject = "Reset your LibreHR password";
    el = React.createElement(PasswordResetEmail, {
      resetUrl: data.props.resetUrl,
      ...(data.props.locale ? { locale: data.props.locale } : {}),
    });
  }

  await mailer.sendMail({ to: data.to, subject, html: await render(el) });
  return { success: true };
}
