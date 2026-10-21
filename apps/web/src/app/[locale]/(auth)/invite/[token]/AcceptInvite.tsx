'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert, primaryButton } from '@/components/auth/Alert';
import { NewPasswordFields, newPasswordState } from '@/components/auth/NewPasswordFields';
import { useRouter } from '@/i18n/routing';
import {
  acceptInvitation,
  AuthError,
  nextPathAfterSignIn,
  signIn,
  withRequestedPath,
} from '@/lib/auth-client';

// FR-ORG-03: قبول الدعوة بتعيين كلمة المرور، ثم الدخول مباشرة.
export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { matches } = newPasswordState(password, confirm);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError(null);
    let email: string;
    try {
      ({ email } = await acceptInvitation(token, password));
    } catch (err) {
      const kind = err instanceof AuthError ? err.kind : 'unexpected';
      setError(
        kind === 'invalidInvitation'
          ? t('invite.invalid')
          : kind === 'invalid'
            ? t('invite.existingAccount')
            : kind === 'locked'
              ? t('invite.locked')
              : t('unexpected'),
      );
      setBusy(false);
      return;
    }
    // الدعوة استُهلكت والحساب مفعّل؛ إن تعثّر الدخول التلقائي فشاشة الدخول هي الطريق.
    try {
      const { twoFactor } = await signIn(email, password);
      router.push(twoFactor ? withRequestedPath('/login/two-factor') : await nextPathAfterSignIn());
    } catch {
      router.push('/login');
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-[480px] flex-col gap-5 rounded-2xl border border-border bg-surface p-9"
    >
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[26px] leading-snug font-bold">{t('invite.title')}</h1>
        <p className="m-0 text-[15px] leading-relaxed text-fg-muted">{t('invite.subtitle')}</p>
      </div>

      {error && <Alert>{error}</Alert>}

      <NewPasswordFields
        label={t('invite.newPassword')}
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
      />

      <button type="submit" disabled={busy || !matches} aria-busy={busy} className={primaryButton}>
        {t('invite.submit')}
      </button>

      <p className="m-0 text-[13px] leading-relaxed text-fg-muted">{t('invite.note')}</p>
    </form>
  );
}
