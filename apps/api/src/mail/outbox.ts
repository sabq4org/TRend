import type { Locale } from '@trend/i18n';
import type { MailMessage } from './templates';

interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * يضيف رسالة إلى auth.mail_outbox ضمن معاملة المستدعي، فتُرسل فقط إن ثبتت المعاملة.
 * العامل (worker.ts) هو من يرسل. مع supersedeKey تُحذف رسائل المفتاح نفسه التي لم تُرسل بعد.
 */
export async function enqueueMail(
  db: Queryable,
  to: string,
  locale: Locale,
  message: MailMessage,
  supersedeKey?: string,
): Promise<void> {
  if (supersedeKey) {
    await db.query('DELETE FROM auth.mail_outbox WHERE supersede_key = $1 AND sent_at IS NULL', [
      supersedeKey,
    ]);
  }
  await db.query(
    `INSERT INTO auth.mail_outbox (template, to_email, locale, payload, supersede_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [message.template, to.trim().toLowerCase(), locale, message.payload, supersedeKey ?? null],
  );
}
