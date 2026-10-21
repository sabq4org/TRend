import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ResetPassword } from './ResetPassword';

export default function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale } = use(params);
  const { token } = use(searchParams);
  setRequestLocale(locale);
  return <ResetPassword token={typeof token === 'string' ? token : null} />;
}
