import type { Locale } from '@trend/i18n';
import type { MailMessage } from './templates';

interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * يضيف رسالة إلى auth.mail_outbox ضمن معاملة المستدعي، فتُرسل فقط إن ثبتت المعاملة.
 * العامل (worker.ts) هو من يرسل.
 */
export async function enqueueMail(
  db: Queryable,
  to: string,
  locale: Locale,
  message: MailMessage,
): Promise<void> {
  await db.query(
    `INSERT INTO auth.mail_outbox (template, to_email, locale, payload) VALUES ($1, $2, $3, $4)`,
    [message.template, to.trim().toLowerCase(), locale, message.payload],
  );
}
