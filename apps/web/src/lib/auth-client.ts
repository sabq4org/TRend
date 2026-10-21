// §8.1: الويب يحمل جلسة Better Auth في كوكي (HttpOnly) على نطاق الخادم، ويطلب منها
// رمز وصول قصير العمر عند الحاجة. لا يُخزن أي رمز في localStorage.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const AUTH = `${API_URL}/api/v1/auth`;

export type AuthErrorKind =
  'invalid' | 'locked' | 'noAccess' | 'expired' | 'invalidInvitation' | 'unexpected';

export class AuthError extends Error {
  constructor(
    readonly kind: AuthErrorKind,
    readonly status: number,
    /** ثوانٍ حتى ينتهي القفل، إن عُرفت. */
    readonly retryAfter?: number,
  ) {
    super(kind);
  }
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  } catch {
    throw new AuthError('unexpected', 0);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return body as T;
  const code = String(body.code ?? '');
  if (res.status === 429) {
    const header = Number(res.headers.get('retry-after'));
    const retryAfter = Number(body.retryAfter ?? header) || undefined;
    throw new AuthError('locked', 429, retryAfter);
  }
  if (code === 'invalidInvitation') throw new AuthError('invalidInvitation', res.status);
  if (code === 'NO_ACTIVE_MEMBERSHIP') throw new AuthError('noAccess', res.status);
  if (code === 'INVALID_TWO_FACTOR_COOKIE') throw new AuthError('expired', res.status);
  if (res.status === 401 || res.status === 400) throw new AuthError('invalid', res.status);
  throw new AuthError('unexpected', res.status);
}

const post = <T>(path: string, body: unknown) =>
  call<T>(`${AUTH}${path}`, { method: 'POST', body: JSON.stringify(body) });

/** يعيد true إذا كان الحساب يحتاج رمز المصادقة الثنائية قبل إنشاء الجلسة. */
export async function signIn(email: string, password: string): Promise<{ twoFactor: boolean }> {
  const res = await post<{ twoFactorRedirect?: boolean }>('/sign-in/email', { email, password });
  return { twoFactor: Boolean(res.twoFactorRedirect) };
}

export const verifyTotp = (code: string) => post('/two-factor/verify-totp', { code });
export const verifyBackupCode = (code: string) => post('/two-factor/verify-backup-code', { code });

export const enableTwoFactor = (password: string) =>
  post<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', { password });

let pendingToken: Promise<string> | null = null;

/**
 * رمز وصول (15 دقيقة) من الجلسة الحالية؛ كل طلب يدوّر رمز الجلسة.
 * الطلبات المتزامنة تتشارك طلباً واحداً: طلبان بالكوكي نفسه يجعلان الثاني يبدو إعادة استخدام.
 */
export function accessToken(): Promise<string> {
  pendingToken ??= call<{ token: string }>(`${AUTH}/token`)
    .then(({ token }) => token)
    .finally(() => {
      pendingToken = null;
    });
  return pendingToken;
}

/** يُنهي الجلسة الحالية على الخادم ويحذف كوكيها. */
export const signOut = () => post('/sign-out', {});

export interface Me {
  id: string;
  email: string;
  mfaRequired: boolean;
}

export async function me(): Promise<Me> {
  const token = await accessToken();
  return call<Me>(`${API_URL}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
}

export const acceptInvitation = (token: string, password: string) =>
  call<{ email: string }>(`${API_URL}/api/v1/invitations/accept`, {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });

/**
 * الصفحة التي طلبها المستخدم قبل تحويله للدخول (?next=). تُقبل المسارات الداخلية فقط،
 * فلا يصلح الرابط لإعادة التوجيه إلى موقع آخر.
 */
export function requestedPath(): string | null {
  if (typeof window === 'undefined') return null;
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}

/** يضيف ?next= إلى مسار من شاشات الدخول إن كان المستخدم قادماً من صفحة محمية. */
export function withRequestedPath(path: string): string {
  const next = requestedPath();
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

/** §9.2: المالك والمشرف بلا مصادقة ثنائية يُوجَّهان لتفعيلها قبل أي شيء آخر. */
export async function nextPathAfterSignIn(): Promise<string> {
  const profile = await me();
  return profile.mfaRequired ? '/setup-mfa' : (requestedPath() ?? '/');
}
