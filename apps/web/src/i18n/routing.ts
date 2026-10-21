import { defaultLocale, locales } from '@trend/i18n';
import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';

// FR-ADM-04 / §10.2: العربية افتراضياً، والإنجليزية بديل.
// العربية دائماً عند الدخول الأول بغض النظر عن لغة المتصفح؛ اختيار المستخدم يُحفظ بعدها.
export const routing = defineRouting({ locales, defaultLocale, localeDetection: false });

export const { Link, usePathname, useRouter } = createNavigation(routing);
