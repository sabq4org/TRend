import { useTranslations } from 'next-intl';
import { LocaleSwitch } from '../LocaleSwitch';

export function AuthHeader() {
  const t = useTranslations('app');
  return (
    <header className="mx-auto flex w-full max-w-[440px] items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-[10px] bg-primary text-lg font-bold text-on-primary"
        >
          {t('name').charAt(0)}
        </span>
        <span className="text-xl font-bold">{t('name')}</span>
      </div>
      <LocaleSwitch />
    </header>
  );
}
