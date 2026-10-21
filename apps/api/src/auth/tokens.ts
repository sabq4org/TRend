import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../config';

// §8.1: رمز وصول قصير العمر (15 دقيقة). إصدار الرموز وتدوير رمز التجديد والمصادقة الثنائية
// تأتي مع وحدة الهوية في الدفعة التالية من المرحلة 2؛ هنا التحقق فقط.

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const claimsSchema = z.object({
  sub: z.string().uuid(),
  tid: z.string().uuid(),
});
export type AccessClaims = z.infer<typeof claimsSchema>;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function verifyAccessToken(token: string, config: AppConfig): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(config.JWT_SECRET), {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    algorithms: ['HS256'],
    requiredClaims: ['exp', 'iat'],
  });
  return claimsSchema.parse(payload);
}

export async function signAccessToken(
  claims: AccessClaims,
  config: AppConfig,
  ttlSeconds = ACCESS_TOKEN_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ tid: claims.tid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(config.JWT_SECRET));
}
