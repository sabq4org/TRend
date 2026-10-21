'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/routing';

/** §9.2: الحساب مقفل 15 دقيقة بعد 5 محاولات خاطئة؛ عدّاد تنازلي حتى انتهاء القفل. */
export function Locked({
  retryAfter = 15 * 60,
  onBack,
}: {
  retryAfter?: number;
  onBack: () => void;
}) {
  const t = useTranslations('auth');
  const [left, setLeft] = useState(retryAfter);

  useEffect(() => {
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const two = (n: number) => String(n).padStart(2, '0');
  const clock = `${two(Math.floor(left / 60))}:${two(left % 60)}`;

  return (
    <div
      role="alert"
      className="flex w-full max-w-[480px] flex-col items-center gap-5 rounded-2xl border border-border bg-surface px-9 py-10 text-center"
    >
      <div
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full bg-high/15 text-high"
      >
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h1 className="m-0 text-2xl font-bold">{t('locked.title')}</h1>
      <p className="m-0 text-[15px] leading-loose text-fg-muted">{t('locked.body')}</p>
      <div dir="ltr" className="text-[40px] font-bold tabular-nums" aria-live="off">
        {clock}
      </div>
      <p className="m-0 text-sm leading-loose text-fg-muted">{t('locked.hint')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/forgot-password"
          className="flex h-12 items-center rounded-[10px] border border-border px-6 text-[15px] font-semibold"
        >
          {t('locked.forgot')}
        </Link>
        <button
          type="button"
          onClick={onBack}
          disabled={left > 0}
          className="flex h-12 items-center rounded-[10px] px-6 text-[15px] font-semibold text-primary disabled:text-fg-muted"
        >
          {t('backToLogin')}
        </button>
      </div>
    </div>
  );
}
