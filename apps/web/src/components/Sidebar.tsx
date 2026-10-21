import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { LocaleSwitch } from './LocaleSwitch';
import { ThemeToggle } from './ThemeToggle';

// §10.3: شريط جانبي (أيمن في العربية تلقائياً بحكم الاتجاه).
const items = [
  'home',
  'tasks',
  'projects',
  'chats',
  'meetings',
  'notes',
  'performance',
  'calendar',
  'support',
  'settings',
] as const;

export function Sidebar() {
  const t = useTranslations();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-e border-border bg-surface p-4">
      <div className="mb-6 text-xl font-bold text-primary">{t('app.name')}</div>
      <nav aria-label={t('app.name')}>
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item}>
              <Link
                href={item === 'home' ? '/' : `/${item}`}
                className="flex min-h-[var(--touch-target)] items-center rounded-md px-3 text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
              >
                {t(`nav.${item}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto flex gap-2 pt-6">
        <LocaleSwitch />
        <ThemeToggle />
      </div>
    </aside>
  );
}
