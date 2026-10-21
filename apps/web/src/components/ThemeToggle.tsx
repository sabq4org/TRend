'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

// FR-ADM-04: وضع فاتح وداكن. التفضيل محلي إلى أن يُحفظ في إعدادات المستخدم.
export function ThemeToggle() {
  const t = useTranslations('common');
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('trend-theme') as Theme | null;
    const initial =
      saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('trend-theme', next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      className="flex min-h-[var(--touch-target)] items-center rounded-md border border-border px-3 text-sm"
    >
      {t('theme')}: {theme === 'dark' ? t('themeDark') : t('themeLight')}
    </button>
  );
}
