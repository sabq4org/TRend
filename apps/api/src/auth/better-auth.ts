import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { bearer, haveIBeenPwned, jwt, twoFactor } from 'better-auth/plugins';
import type { Pool } from 'pg';
import type { AppConfig } from '../config';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from './password';

// §6.3: المصادقة بـ Better Auth (قرار المالك في 2026-10-21) داخل الخادم نفسه.
// هوية الدخول في مخطط auth، ومستخدم ترند ومستأجره يُحلّان عند إصدار رمز الوصول.

export const AUTH_BASE_PATH = '/api/v1/auth';
export const ACCESS_TOKEN_TTL = '15m';
/** §9.2: قفل الحساب بعد 5 محاولات فاشلة. */
export const MAX_FAILED_SIGN_INS = 5;
export const LOCKOUT_SECONDS = 15 * 60;
/** مهلة قبول رمز التجديد السابق بعد تدويره، حتى لا تخرج نافذتان تجددان معاً. */
const ROTATION_GRACE_SECONDS = 30;

export interface ResolvedLogin {
  userId: string;
  tenantId: string;
  privileged: boolean;
}

export interface AuthDeps {
  config: AppConfig;
  /** اتصال دور Better Auth (مخطط auth). */
  authPool: Pool;
  /** اتصال دور التطبيق، لدالة app.resolve_login فقط. */
  appPool: Pool;
}

export function createAuth({ config, authPool, appPool }: AuthDeps) {
  const resolveLogin = async (identity: string): Promise<ResolvedLogin> => {
    const { rows } = await appPool.query<{
      user_id: string;
      tenant_id: string;
      privileged: boolean;
    }>('SELECT * FROM app.resolve_login($1)', [identity]);
    const row = rows[0];
    // هوية دخول بلا مستخدم نشط في أي مستأجر لا تحصل على رمز وصول.
    if (!row)
      throw new APIError('FORBIDDEN', {
        code: 'NO_ACTIVE_MEMBERSHIP',
        message: 'No active account',
      });
    return { userId: row.user_id, tenantId: row.tenant_id, privileged: row.privileged };
  };

  return betterAuth({
    appName: 'TRend',
    basePath: AUTH_BASE_PATH,
    baseURL: config.AUTH_BASE_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: config.CORS_ORIGINS,
    database: authPool,
    telemetry: { enabled: false },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: config.NODE_ENV === 'production',
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    // FR-ORG-03: الدخول بالدعوة فقط؛ لا تسجيل ذاتي.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: config.NODE_ENV === 'production', window: 60, max: 100 },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const email = String(ctx.body?.email ?? '')
          .trim()
          .toLowerCase();
        const { rows } = await authPool.query<{ locked_until: Date }>(
          'SELECT locked_until FROM login_lockouts WHERE email = $1 AND locked_until > now()',
          [email],
        );
        if (rows[0]) {
          const retryAfter = Math.ceil((rows[0].locked_until.getTime() - Date.now()) / 1000);
          throw new APIError('TOO_MANY_REQUESTS', {
            code: 'ACCOUNT_LOCKED',
            message: 'Too many failed sign-in attempts',
            retryAfter,
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const email = String(ctx.body?.email ?? '')
          .trim()
          .toLowerCase();
        const failed =
          ctx.context.returned instanceof APIError && ctx.context.returned.statusCode === 401;
        if (!failed) {
          await authPool.query('DELETE FROM login_lockouts WHERE email = $1', [email]);
          return;
        }
        await authPool.query(
          `INSERT INTO login_lockouts (email, failed_count) VALUES ($1, 1)
           ON CONFLICT (email) DO UPDATE SET
             failed_count = CASE WHEN login_lockouts.failed_count + 1 >= $2 THEN 0
                                 ELSE login_lockouts.failed_count + 1 END,
             locked_until = CASE WHEN login_lockouts.failed_count + 1 >= $2
                                 THEN now() + make_interval(secs => $3)
                                 ELSE login_lockouts.locked_until END,
             updated_at = now()`,
          [email, MAX_FAILED_SIGN_INS, LOCKOUT_SECONDS],
        );
      }),
    },
    plugins: [
      // §9.2: TOTP، إلزامي للمالك والمشرفين (يُفرض في حارس الخادم) واختياري للبقية.
      twoFactor({
        issuer: 'TRend',
        accountLockout: {
          enabled: true,
          maxFailedAttempts: MAX_FAILED_SIGN_INS,
          durationSeconds: LOCKOUT_SECONDS,
        },
      }),
      // §8.1: رمز وصول 15 دقيقة يحمل المستخدم والمستأجر وحالة المصادقة الثنائية.
      jwt({
        jwt: {
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          expirationTime: ACCESS_TOKEN_TTL,
          definePayload: async ({ user }) => {
            const login = await resolveLogin(user.id);
            return {
              tid: login.tenantId,
              priv: login.privileged,
              mfa: Boolean((user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled),
            };
          },
          getSubject: async ({ user }) => (await resolveLogin(user.id)).userId,
        },
      }),
      // §8.1: رمز التجديد يدور عند كل استخدام. يأتي قبل bearer ليصل الرمز الجديد للجوال أيضاً.
      {
        id: 'trend-session-rotation',
        hooks: {
          after: [
            {
              matcher: (ctx) => ctx.path === '/token',
              handler: createAuthMiddleware(async (ctx) => {
                const current = ctx.context.session;
                if (!current || ctx.context.returned instanceof APIError) return;
                const adapter = ctx.context.internalAdapter;
                const next = await adapter.createSession(current.user.id);
                await adapter.updateSession(current.session.token, {
                  expiresAt: new Date(Date.now() + ROTATION_GRACE_SECONDS * 1000),
                });
                await setSessionCookie(ctx, { session: next, user: current.user });
              }),
            },
          ],
        },
      },
      // الجوال: رمز الجلسة في ترويسة Authorization بدل الكوكيز.
      bearer(),
      ...(config.AUTH_CHECK_PWNED ? [haveIBeenPwned()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
