'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert, primaryButton } from '@/components/auth/Alert';
import { Locked } from '@/components/auth/Locked';
import { inputClass } from '@/components/auth/PasswordField';
import { Link, useRouter } from '@/i18n/routing';
import { AuthError, nextPathAfterSignIn, verifyBackupCode, verifyTotp } from '@/lib/auth-client';

// §9.2: الخطوة الثانية من الدخول برمز TOTP من تطبيق المصادقة، أو برمز احتياطي.
export function TwoFactorForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code')).replace(/\s/g, '');
    setBusy(true);
    setError(null);
    try {
      await (backup ? verifyBackupCode(code) : verifyTotp(code));
      router.push(await nextPathAfterSignIn());
    } catch (err) {
      setError(err instanceof AuthError ? err : new AuthError('unexpected', 0));
      setBusy(false);
    }
  }

  if (error?.kind === 'locked') {
    return <Locked retryAfter={error.retryAfter} onBack={() => router.push('/login')} />;
  }

  const message =
    error?.kind === 'invalid'
      ? t('twoFactor.invalid')
      : error?.kind === 'expired'
        ? t('twoFactor.expired')
        : error
          ? t('unexpected')
          : null;

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-[480px] flex-col gap-6 rounded-2xl border border-border bg-surface px-9 py-10"
    >
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[26px] font-bold">
          {backup ? t('twoFactor.backupTitle') : t('twoFactor.title')}
        </h1>
        <p className="m-0 text-[15px] leading-relaxed text-fg-muted">
          {backup ? t('twoFactor.backupSubtitle') : t('twoFactor.subtitle')}
        </p>
      </div>

      {message && <Alert>{message}</Alert>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="code" className="text-sm font-semibold">
          {backup ? t('twoFactor.backupCode') : t('twoFactor.code')}
        </label>
        <input
          key={backup ? 'backup' : 'totp'}
          id="code"
          name="code"
          dir="ltr"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={backup ? 'text' : 'numeric'}
          pattern={backup ? undefined : '[0-9 ]{6,7}'}
          maxLength={backup ? 32 : 7}
          className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em]`}
        />
      </div>

      <button type="submit" disabled={busy} aria-busy={busy} className={primaryButton}>
        {t('twoFactor.submit')}
      </button>

      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={() => {
            setBackup(!backup);
            setError(null);
          }}
          className="min-h-11 text-primary"
        >
          {backup ? t('twoFactor.useApp') : t('twoFactor.useBackup')}
        </button>
        <Link href="/login" className="flex min-h-11 items-center text-fg-muted">
          {t('backToLogin')}
        </Link>
      </div>
    </form>
  );
}
