import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { TwoFactorForm } from './TwoFactorForm';

export default function TwoFactorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <TwoFactorForm />;
}
