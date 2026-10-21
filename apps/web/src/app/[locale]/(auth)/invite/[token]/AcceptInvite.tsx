'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert, primaryButton } from '@/components/auth/Alert';
import { PasswordField } from '@/components/auth/PasswordField';
import { useRouter } from '@/i18n/routing';
import {
  acceptInvitation,
  AuthError,
  nextPathAfterSignIn,
  signIn,
  withRequestedPath,
} from '@/lib/auth-client';

// يطابق acceptInvitationSchema في الخادم.
const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

// FR-ORG-03: قبول الدعوة بتعيين كلمة المرور، ثم الدخول مباشرة.
export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const longEnough = password.length >= MIN_LENGTH && password.length <= MAX_LENGTH;
  const matches = longEnough && password === confirm;

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

      <PasswordField
        id="new-password"
        name="password"
        label={t('invite.newPassword')}
        required
        minLength={MIN_LENGTH}
        maxLength={MAX_LENGTH}
        autoComplete="new-password"
        aria-describedby="password-rules"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <PasswordField
        id="confirm-password"
        name="confirm"
        label={t('invite.confirm')}
        required
        maxLength={MAX_LENGTH}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />

      <ul id="password-rules" className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
        <Rule met={longEnough}>{t('invite.ruleLength')}</Rule>
        <Rule met={matches}>{t('invite.ruleMatch')}</Rule>
      </ul>

      <button type="submit" disabled={busy || !matches} aria-busy={busy} className={primaryButton}>
        {t('invite.submit')}
      </button>

      <p className="m-0 text-[13px] leading-relaxed text-fg-muted">{t('invite.note')}</p>
    </form>
  );
}

function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${met ? 'text-done' : 'text-fg-muted'}`}>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {met ? <polyline points="20 6 9 17 4 12" /> : <circle cx="12" cy="12" r="9" />}
      </svg>
      {children}
    </li>
  );
}
