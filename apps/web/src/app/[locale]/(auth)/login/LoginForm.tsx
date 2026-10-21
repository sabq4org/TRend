'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert, primaryButton } from '@/components/auth/Alert';
import { Locked } from '@/components/auth/Locked';
import { inputClass, PasswordField } from '@/components/auth/PasswordField';
import { useRouter } from '@/i18n/routing';
import { AuthError, nextPathAfterSignIn, signIn } from '@/lib/auth-client';

// §9.2: الدخول ببريد العمل وكلمة المرور؛ القفل بعد 5 محاولات يظهر بمدة متبقية.
export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [error, setError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { twoFactor } = await signIn(String(form.get('email')), String(form.get('password')));
      router.push(twoFactor ? '/login/two-factor' : await nextPathAfterSignIn());
    } catch (err) {
      setError(err instanceof AuthError ? err : new AuthError('unexpected', 0));
      setBusy(false);
    }
  }

  if (error?.kind === 'locked') {
    return <Locked retryAfter={error.retryAfter} onBack={() => setError(null)} />;
  }

  const message =
    error?.kind === 'invalid'
      ? t('login.invalid')
      : error?.kind === 'noAccess'
        ? t('login.noAccess')
        : error
          ? t('unexpected')
          : null;

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[440px] flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[28px] leading-snug font-bold">{t('login.title')}</h1>
        <p className="m-0 text-[15px] leading-relaxed text-fg-muted">{t('login.subtitle')}</p>
      </div>

      {message && <Alert>{message}</Alert>}

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

      <PasswordField
        id="password"
        name="password"
        label={t('password')}
        required
        autoComplete="current-password"
      />

      <button type="submit" disabled={busy} aria-busy={busy} className={primaryButton}>
        {t('login.submit')}
      </button>

      <p className="m-0 text-center text-[13px] leading-relaxed text-fg-muted">
        {t('login.inviteOnly')}
      </p>
    </form>
  );
}
