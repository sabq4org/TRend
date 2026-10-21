'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert, primaryButton } from '@/components/auth/Alert';
import { NewPasswordFields, newPasswordState } from '@/components/auth/NewPasswordFields';
import { Link } from '@/i18n/routing';
import { AuthError, resetPassword } from '@/lib/auth-client';

type State = 'form' | 'invalid' | 'done';

// §9.2: كلمة مرور جديدة من رابط البريد. الخادم يتحقق منها (الطول والتسريبات) وينهي كل الجلسات.
export function ResetPassword({ token }: { token: string | null }) {
  const t = useTranslations('auth');
  const [state, setState] = useState<State>(token ? 'form' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { matches } = newPasswordState(password, confirm);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || !matches) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setState('done');
    } catch (err) {
      const kind = err instanceof AuthError ? err.kind : 'unexpected';
      if (kind === 'invalidToken') setState('invalid');
      else setError(kind === 'compromised' ? t('reset.compromised') : t('unexpected'));
    } finally {
      setBusy(false);
    }
  }

  const card =
    'flex w-full max-w-[480px] flex-col gap-5 rounded-2xl border border-border bg-surface p-9';

  if (state === 'invalid') {
    return (
      <div className={card}>
        <h1 className="m-0 text-[26px] leading-snug font-bold">{t('reset.title')}</h1>
        <Alert>{t('reset.invalid')}</Alert>
        <Link href="/forgot-password" className={`${primaryButton} px-6`}>
          {t('reset.requestNew')}
        </Link>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div role="status" className={card}>
        <h1 className="m-0 text-[26px] leading-snug font-bold">{t('reset.doneTitle')}</h1>
        <p className="m-0 text-[15px] leading-relaxed text-fg-muted">{t('reset.doneBody')}</p>
        <Link href="/login" className={`${primaryButton} px-6`}>
          {t('reset.toLogin')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={card}>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[26px] leading-snug font-bold">{t('reset.title')}</h1>
        <p className="m-0 text-[15px] leading-relaxed text-fg-muted">{t('reset.subtitle')}</p>
      </div>

      {error && <Alert>{error}</Alert>}

      <NewPasswordFields
        label={t('newPassword.label')}
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
      />

      <button type="submit" disabled={busy || !matches} aria-busy={busy} className={primaryButton}>
        {t('reset.submit')}
      </button>
    </form>
  );
}
