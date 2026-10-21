'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert, primaryButton } from '@/components/auth/Alert';
import { inputClass } from '@/components/auth/PasswordField';
import { Link } from '@/i18n/routing';
import { AuthError, requestPasswordReset } from '@/lib/auth-client';

// §9.2: طلب رابط الاستعادة. الرد واحد سواء كان البريد مسجلاً أم لا، فلا تكشف الشاشة الحسابات.
export function ForgotPassword() {
  const t = useTranslations('auth');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email')).trim();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSentTo(email);
    } catch (err) {
      setError(
        err instanceof AuthError && err.kind === 'locked' ? t('forgot.tooMany') : t('unexpected'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div
        role="status"
        className="flex w-full max-w-[440px] flex-col gap-4 rounded-2xl border border-border bg-surface p-9"
      >
        <h1 className="m-0 text-[26px] leading-snug font-bold">{t('forgot.sentTitle')}</h1>
        <p className="m-0 text-[15px] leading-relaxed">
          {t.rich('forgot.sentBody', {
            email: () => (
              <bdi dir="ltr" className="font-semibold">
                {sentTo}
              </bdi>
            ),
          })}
        </p>
        <p className="m-0 text-sm leading-relaxed text-fg-muted">{t('forgot.sentHint')}</p>
        <Link href="/login" className="text-[15px] font-semibold text-primary">
          {t('backToLogin')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[440px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[28px] leading-snug font-bold">{t('forgot.title')}</h1>
        <p className="m-0 text-[15px] leading-relaxed text-fg-muted">{t('forgot.subtitle')}</p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-semibold">
          {t('email')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          required
          autoComplete="username"
          placeholder="name@company.sa"
          className={inputClass}
        />
      </div>

      <button type="submit" disabled={busy} aria-busy={busy} className={primaryButton}>
        {t('forgot.submit')}
      </button>

      <Link href="/login" className="text-center text-[15px] font-semibold text-primary">
        {t('backToLogin')}
      </Link>
    </form>
  );
}
