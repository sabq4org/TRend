import { directionOf, isLocale } from '@trend/i18n';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { routing } from '@/i18n/routing';
import '../globals.css';

const plex = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-plex',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });
  return { title: t('name'), description: t('tagline') };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale) || !isLocale(locale)) notFound();
  setRequestLocale(locale);

  return (
    // §10.2: الاتجاه مشتق من اللغة، والتخطيط بالخصائص المنطقية فيعمل RTL وLTR دون كود إضافي.
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={plex.variable}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <NextIntlClientProvider>
          <div className="flex min-h-dvh">
            <Sidebar />
            <main className="flex-1 p-6">{children}</main>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
