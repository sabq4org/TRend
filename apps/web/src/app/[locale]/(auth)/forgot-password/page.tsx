import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ForgotPassword } from './ForgotPassword';

export default function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <ForgotPassword />;
}
