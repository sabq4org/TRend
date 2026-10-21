import ar from '../messages/ar.json';
import en from '../messages/en.json';

export * from './arabic';

export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ar';

/** §10.2: العربية لغة التصميم الأولى، والاتجاه مشتق من اللغة. */
export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export type Messages = typeof ar;
export const messages: Record<Locale, Messages> = { ar, en };
