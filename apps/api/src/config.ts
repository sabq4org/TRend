import { z } from 'zod';

// §9.2: لا أسرار في الكود؛ كل الإعدادات من البيئة (مدير الأسرار في الإنتاج).
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().url(),
    /** دور Better Auth: يصل إلى مخطط auth وحده. */
    AUTH_DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    /** العنوان العام للخادم كما يراه المتصفح (لروابط المصادقة والكوكيز). */
    AUTH_BASE_URL: z.string().url().default('http://localhost:4000'),
    /** عنوان تطبيق الويب (لروابط الدعوات). */
    WEB_URL: z.string().url().default('http://localhost:3000'),
    /** §9.2: فحص كلمات المرور ضد القوائم المسرّبة (يتصل بخدمة خارجية بإخفاء k-anonymity). */
    AUTH_CHECK_PWNED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** §6.6: مزود البريد عبر SMTP، مثل smtp://user:pass@email-smtp.me-central-1.amazonaws.com:587. */
    MAIL_SMTP_URL: z.string().url().optional(),
    MAIL_FROM: z.string().default('ترند <no-reply@trend.local>'),
    /** عامل صندوق البريد في هذه النسخة. الاختبارات تشغّله يدوياً. */
    MAIL_WORKER: z.enum(['true', 'false']).optional(),
    JWT_ISSUER: z.string().default('trend'),
    JWT_AUDIENCE: z.string().default('trend-api'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.MAIL_SMTP_URL, {
    path: ['MAIL_SMTP_URL'],
    message: 'MAIL_SMTP_URL is required in production',
  })
  .transform(({ MAIL_WORKER, ...c }) => ({
    ...c,
    MAIL_WORKER: MAIL_WORKER ? MAIL_WORKER === 'true' : c.NODE_ENV !== 'test',
  }));

export type AppConfig = z.infer<typeof envSchema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
