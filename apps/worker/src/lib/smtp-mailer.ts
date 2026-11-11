import nodemailer from "nodemailer";
import type { SmtpConfig } from "../env.js";
import type { MailMessage, MailSender } from "../queues/email.send.js";

/** nodemailer-backed transport, mirroring apps/api/src/adapters/mail-smtp.ts. */
export function createSmtpMailer(config: SmtpConfig): MailSender {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    ...(config.user && config.pass
      ? { auth: { user: config.user, pass: config.pass } }
      : {}),
  });
  return {
    async sendMail(message: MailMessage): Promise<void> {
      await transporter.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
      });
    },
  };
}
