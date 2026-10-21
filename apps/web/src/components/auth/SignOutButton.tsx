'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { signOut } from '@/lib/auth-client';

export function SignOutButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    // إن تعذّر الوصول للخادم نكمل إلى شاشة الدخول؛ الجلسة تنتهي وحدها.
    await signOut().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex min-h-[var(--touch-target)] items-center rounded-md px-3 text-start text-fg-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
    >
      {t('signOut')}
    </button>
  );
}
