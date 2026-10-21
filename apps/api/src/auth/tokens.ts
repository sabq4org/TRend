import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../config';
import type { Auth } from './better-auth';

// §8.1: رمز وصول قصير العمر (15 دقيقة) يصدره Better Auth من الجلسة، ويُتحقق منه هنا
// بالمفاتيح العامة (JWKS) المخزنة محلياً دون استعلام قاعدة البيانات في كل طلب.

const claimsSchema = z.object({
  sub: z.string().uuid(),
  tid: z.string().uuid(),
  /** المستخدم مالك أو مشرف في مساحة ما. */
  priv: z.boolean(),
  /** المصادقة الثنائية مفعّلة (وقد اجتيزت عند الدخول). */
  mfa: z.boolean(),
});
export type AccessClaims = z.infer<typeof claimsSchema>;

const JWKS_TTL_MS = 5 * 60 * 1000;

export class AccessTokenVerifier {
  private jwks: ReturnType<typeof createLocalJWKSet> | null = null;
  private loadedAt = 0;

  constructor(
    private readonly auth: Auth,
    private readonly config: AppConfig,
  ) {}

  private async keys(force = false) {
    if (force || !this.jwks || Date.now() - this.loadedAt > JWKS_TTL_MS) {
      const set = (await this.auth.api.getJwks()) as JSONWebKeySet;
      this.jwks = createLocalJWKSet(set);
      this.loadedAt = Date.now();
    }
    return this.jwks;
  }

  async verify(token: string): Promise<AccessClaims> {
    const opts = { issuer: this.config.JWT_ISSUER, audience: this.config.JWT_AUDIENCE };
    try {
      const { payload } = await jwtVerify(token, await this.keys(), opts);
      return claimsSchema.parse(payload);
    } catch (e) {
      // مفتاح جديد بعد تدوير المفاتيح: نعيد التحميل مرة واحدة.
      if ((e as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw e;
      const { payload } = await jwtVerify(token, await this.keys(true), opts);
      return claimsSchema.parse(payload);
    }
  }
}

/** إصدار رمز وصول من الخادم مباشرةً (للاختبارات وأدوات التطوير). */
export async function issueAccessToken(
  auth: Auth,
  claims: AccessClaims & { exp?: number },
): Promise<string> {
  const { token } = await auth.api.signJWT({ body: { payload: claims } });
  return token;
}
