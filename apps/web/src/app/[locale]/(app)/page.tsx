import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations('home');

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {/* §10.6: الحالات الفارغة مفيدة — تشرح ما سيظهر هنا. */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-medium">{t('emptyTitle')}</h2>
        <p className="mt-2 text-fg-muted">{t('emptyBody')}</p>
      </div>
    </section>
  );
}
