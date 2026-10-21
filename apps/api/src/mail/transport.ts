import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { AppConfig } from '../config';

// §6.6: المزود (SES أو Postmark أو Resend) يُوصل عبر SMTP، وكلها تدعمه، فيُبدَّل
// بتغيير MAIL_SMTP_URL دون تغيير الكود. محلياً: Mailpit في docker-compose.

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export function smtpTransport(url: string): MailTransport {
  const transporter = createTransport(url);
  return {
    async send(mail) {
      await transporter.sendMail(mail);
    },
  };
}

/** للتطوير بلا خادم بريد: يكتب الرسالة في السجل، ومعها الرابط. لا يُقبل في الإنتاج. */
export function logTransport(): MailTransport {
  const logger = new Logger('Mail');
  return {
    async send(mail) {
      logger.log(`To ${mail.to}: ${mail.subject}\n${mail.text}`);
    },
  };
}

/** للاختبارات: يحتفظ بما أُرسل. */
export class MemoryTransport implements MailTransport {
  readonly sent: OutgoingMail[] = [];
  failNext = 0;

  async send(mail: OutgoingMail) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('simulated provider failure');
    }
    this.sent.push(mail);
  }
}

export function transportFor(config: AppConfig): MailTransport {
  return config.MAIL_SMTP_URL ? smtpTransport(config.MAIL_SMTP_URL) : logTransport();
}
