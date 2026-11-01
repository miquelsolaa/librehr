import nodemailer from "nodemailer";
import type { MailPort, MailMessage } from "../ports/mail.js";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
}

export class SmtpMailAdapter implements MailPort {
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor(config: SmtpConfig) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth:
        config.user && config.pass
          ? { user: config.user, pass: config.pass }
          : undefined,
    });
  }

  async sendMail(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
    });
  }
}
