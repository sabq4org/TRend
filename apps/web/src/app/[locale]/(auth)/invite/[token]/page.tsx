import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { AcceptInvite } from './AcceptInvite';

export default function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = use(params);
  setRequestLocale(locale);
  return <AcceptInvite token={token} />;
}
