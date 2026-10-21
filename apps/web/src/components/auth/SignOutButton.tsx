'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { Alert } from './Alert';
import { signOut } from '@/lib/auth-client';

export function SignOutButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    setBusy(true);
    setFailed(false);
    try {
      await signOut();
      router.replace('/login');
    } catch {
      // الجلسة باقية على الخادم ما لم يُلغها؛ لا نوهم المستخدم بأنه خرج.
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy}
        className="flex min-h-[var(--touch-target)] items-center rounded-md px-3 text-start text-fg-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        {t('signOut')}
      </button>
      {failed && <Alert>{t('signOutFailed')}</Alert>}
    </div>
  );
}
