import type { Locale } from '@trend/i18n';
import type { Pool } from 'pg';
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

/**
 * يضيف الرسالة إلا إن أُضيفت رسالة من القالب نفسه للعنوان نفسه خلال المدة. القفل الاستشاري
 * على العنوان يجعل الفحص والإضافة ذريّين بين الطلبات المتزامنة ونسخ الخادم.
 */
export async function enqueueMailAtMostEvery(
  pool: Pool,
  seconds: number,
  to: string,
  locale: Locale,
  message: MailMessage,
): Promise<boolean> {
  const email = to.trim().toLowerCase();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `mail:${message.template}:${email}`,
    ]);
    const recent = await c.query(
      `SELECT 1 FROM auth.mail_outbox WHERE to_email = $1 AND template = $2
          AND created_at > now() - make_interval(secs => $3)`,
      [email, message.template, seconds],
    );
    if (!recent.rowCount) await enqueueMail(c, email, locale, message);
    await c.query('COMMIT');
    return !recent.rowCount;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
