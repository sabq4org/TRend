'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PasswordField } from './PasswordField';

// يطابق حدود كلمة المرور في الخادم (acceptInvitationSchema وBetter Auth).
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export function newPasswordState(password: string, confirm: string) {
  const longEnough =
    password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
  return { longEnough, matches: longEnough && password === confirm };
}

/** كلمة مرور جديدة وتأكيدها، مع قواعد تتحقق أثناء الكتابة (قبول الدعوة والاستعادة). */
export function NewPasswordFields({
  label,
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  label: string;
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
}) {
  const t = useTranslations('auth.newPassword');
  const { longEnough, matches } = newPasswordState(password, confirm);
  return (
    <>
      <PasswordField
        id="new-password"
        name="password"
        label={label}
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        autoComplete="new-password"
        aria-describedby="password-rules"
        value={password}
        onChange={(e) => onPassword(e.target.value)}
      />
      <PasswordField
        id="confirm-password"
        name="confirm"
        label={t('confirm')}
        required
        maxLength={MAX_PASSWORD_LENGTH}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => onConfirm(e.target.value)}
      />
      <ul id="password-rules" className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
        <Rule met={longEnough}>{t('ruleLength')}</Rule>
        <Rule met={matches}>{t('ruleMatch')}</Rule>
      </ul>
    </>
  );
}

function Rule({ met, children }: { met: boolean; children: ReactNode }) {
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
