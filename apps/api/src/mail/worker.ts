import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { isLocale } from '@trend/i18n';
import type { Pool } from 'pg';
import { AUTH_POOL } from '../auth/auth.module';
import { APP_CONFIG, type AppConfig } from '../config';
import { renderMail, type MailMessage } from './templates';
import { MAIL_TRANSPORT, type MailTransport } from './transport';

/** بعد هذه المحاولات تُترك الرسالة فاشلة ويُمسح رابطها. */
export const MAX_MAIL_ATTEMPTS = 5;
const POLL_MS = 2_000;
/**
 * مدة حجز الصف أثناء إرساله. يُحجز صف واحد في كل مرة، وإرساله محدود بمهلات SMTP
 * (transport.ts، دقيقة على الأكثر)، فلا ينتهي الحجز قبل انتهاء الإرسال فتلتقطه نسخة أخرى.
 */
const LEASE_SECONDS = 120;

interface Row {
  id: string;
  template: MailMessage['template'];
  to_email: string;
  locale: string;
  payload: MailMessage['payload'];
  attempts: number;
}

/**
 * يرسل ما في auth.mail_outbox. عدة نسخ من الخادم تعمل معاً بأمان (SKIP LOCKED).
 * الفشل يُعاد بتأخير متزايد: 1، 2، 4، 8 دقائق.
 */
@Injectable()
export class MailWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    @Inject(AUTH_POOL) private readonly pool: Pool,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.MAIL_WORKER) return;
    this.timer = setInterval(() => {
      this.drain().catch((err: unknown) => this.logger.error(err));
    }, POLL_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** يرسل كل ما استحق الآن ويعيد عدد الرسائل التي أُرسلت. لا تتداخل دورتان في النسخة نفسها. */
  drain(): Promise<number> {
    this.running ??= this.drainAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drainAll(): Promise<number> {
    let sent = 0;
    for (let row = await this.claim(); row; row = await this.claim()) {
      if (await this.deliver(row)) sent++;
    }
    return sent;
  }

  private async claim(): Promise<Row | undefined> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE auth.mail_outbox SET attempts = attempts + 1,
              locked_until = now() + make_interval(secs => $1)
        WHERE id IN (SELECT id FROM auth.mail_outbox
                      WHERE sent_at IS NULL AND attempts < $2 AND send_after <= now()
                        AND (locked_until IS NULL OR locked_until < now())
                      ORDER BY send_after, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, template, to_email, locale, payload, attempts`,
      [LEASE_SECONDS, MAX_MAIL_ATTEMPTS],
    );
    return rows[0];
  }

  private async deliver(row: Row): Promise<boolean> {
    try {
      const locale = isLocale(row.locale) ? row.locale : 'ar';
      const mail = renderMail(locale, {
        template: row.template,
        payload: row.payload,
      } as MailMessage);
      await this.transport.send({ from: this.config.MAIL_FROM, to: row.to_email, ...mail });
      await this.pool.query(
        `UPDATE auth.mail_outbox SET sent_at = now(), payload = '{}', locked_until = NULL,
                last_error = NULL WHERE id = $1`,
        [row.id],
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = row.attempts >= MAX_MAIL_ATTEMPTS;
      this.logger.warn(
        `Mail ${row.id} (${row.template}) attempt ${row.attempts} failed: ${message}`,
      );
      await this.pool.query(
        `UPDATE auth.mail_outbox SET last_error = left($2, 500), locked_until = NULL,
                send_after = now() + make_interval(mins => power(2, $3 - 1)::int),
                payload = CASE WHEN $4 THEN '{}'::jsonb ELSE payload END
          WHERE id = $1`,
        [row.id, message, row.attempts, final],
      );
      return false;
    }
  }
}
