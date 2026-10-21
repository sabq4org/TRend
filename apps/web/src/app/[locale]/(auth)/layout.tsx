import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AuthHeader } from '@/components/auth/AuthHeader';

// شاشات ما قبل الدخول: بلا شريط جانبي. النموذج أولاً (يمين في العربية)، ولوحة التعريف
// بجانبه على الشاشات العريضة وتحته على الجوال.
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('auth');
  const points = [t('brandPoint1'), t('brandPoint2'), t('brandPoint3')];
  return (
    <div className="flex min-h-dvh flex-wrap bg-bg">
      <div className="flex min-w-0 flex-[999_1_520px] flex-col px-6 py-8">
        <AuthHeader />
        <main className="flex flex-1 items-center justify-center py-10">{children}</main>
      </div>
      <aside className="flex min-w-0 flex-[1_1_420px] flex-col justify-center gap-7 bg-primary px-12 py-14 text-on-primary">
        <p className="m-0 max-w-[420px] text-[34px] leading-snug font-bold">{t('brandHeadline')}</p>
        <ul className="m-0 flex max-w-[420px] list-none flex-col gap-4 p-0 text-base leading-relaxed">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3">
              <svg
                aria-hidden="true"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
