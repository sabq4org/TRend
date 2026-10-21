'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';

export function LocaleSwitch() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === 'ar' ? 'en' : 'ar';
  return (
    <Link
      href={pathname}
      locale={other}
      lang={other}
      className="flex min-h-[var(--touch-target)] items-center rounded-md border border-border px-3 text-sm"
    >
      {t('switchLanguage')}
    </Link>
  );
}
