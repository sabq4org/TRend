import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { SetupMfa } from './SetupMfa';

export default function SetupMfaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <SetupMfa />;
}
