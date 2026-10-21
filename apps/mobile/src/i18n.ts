import { defaultLocale, directionOf, isLocale, messages, type Locale } from '@trend/i18n';
import { getLocales } from 'expo-localization';
import { IntlMessageFormat } from 'intl-messageformat';
import { I18nManager } from 'react-native';

// §10.2: العربية أولاً. لغة الجهاز تُحترم إن كانت مدعومة، وإلا فالعربية.
export function deviceLocale(): Locale {
  const code = getLocales()[0]?.languageCode;
  return isLocale(code) ? code : defaultLocale;
}

/** يضبط اتجاه الواجهة؛ يتطلب إعادة تحميل التطبيق عند تغييره (قيد في React Native). */
export function applyDirection(locale: Locale): void {
  const rtl = directionOf(locale) === 'rtl';
  I18nManager.allowRTL(rtl);
  if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
}

export function translator(locale: Locale) {
  return (key: string, values?: Record<string, unknown>): string => {
    const raw = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        messages[locale],
      );
    if (typeof raw !== 'string') return key;
    return values ? String(new IntlMessageFormat(raw, locale).format(values)) : raw;
  };
}
