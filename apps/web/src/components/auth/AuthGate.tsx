'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from '@/i18n/routing';
import { AuthError, me } from '@/lib/auth-client';
import { primaryButton } from './Alert';

type State = 'checking' | 'ready' | 'offline';

/**
 * §8.1 / §9.2: صفحات التطبيق لمن سجّل الدخول فقط. الجلسة كوكي على نطاق الخادم لا يراه
 * خادم الويب، فالتحقق يجري في المتصفح: بلا جلسة يُحوَّل المستخدم إلى الدخول ومعه الصفحة
 * التي طلبها، والمالك أو المشرف بلا مصادقة ثنائية إلى تفعيلها. لا يُعرض شيء قبل التحقق.
 * الخادم يفرض الصلاحيات على كل طلب بيانات؛ هذا الحارس لتجربة الاستخدام فقط.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const t = useTranslations('auth.gate');
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<State>('checking');

  // الصفحة المطلوبة بمعاملاتها، دون بادئة اللغة التي يضيفها الموجّه.
  const returnTo = useCallback(() => {
    const next = pathname + window.location.search;
    return next === '/' ? {} : { next };
  }, [pathname]);

  const check = useCallback(() => {
    setState('checking');
    me().then(
      (profile) => {
        if (profile.mfaRequired) router.replace({ pathname: '/setup-mfa', query: returnTo() });
        else setState('ready');
      },
      (err: unknown) => {
        if (err instanceof AuthError && (err.status === 401 || err.kind === 'noAccess')) {
          router.replace({ pathname: '/login', query: returnTo() });
        } else {
          setState('offline');
        }
      },
    );
  }, [router, returnTo]);

  useEffect(check, [check]);

  if (state === 'ready') return children;
  if (state === 'offline') {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div role="alert" className="flex max-w-md flex-col items-center gap-4 text-center">
          <p className="m-0 text-[15px] leading-relaxed text-fg-muted">{t('offline')}</p>
          <button type="button" onClick={check} className={`${primaryButton} px-6`}>
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
      <p className="text-fg-muted">{t('checking')}</p>
    </div>
  );
}
