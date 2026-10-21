import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { LoginForm } from './LoginForm';

export default function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <LoginForm />;
}
