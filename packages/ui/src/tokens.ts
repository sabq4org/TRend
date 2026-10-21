// §10.1: رموز التصميم تُعرّف مرة واحدة هنا، وتولّد متغيرات CSS للويب وثوابت للجوال.
// هوية ترند البصرية والخط المؤسسي سؤال مفتوح (الملحق 17.3)؛ القيم أدناه افتراضية محايدة
// تُستبدل بهوية ترند دون تغيير أي شاشة.

export const fontFamily = {
  /** §6.1: IBM Plex Sans Arabic افتراضياً حتى يُحسم الخط المؤسسي. */
  sans: "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, system-ui, sans-serif",
} as const;

export const radius = { sm: 6, md: 10, lg: 16, full: 9999 } as const;

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** §10.5: أهداف اللمس لا تقل عن 44 نقطة. */
export const minTouchTarget = 44;

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  /** §10.1: ألوان الحالة ثابتة المعنى، ولا يُعتمد على اللون وحده. */
  statusOverdue: string;
  statusHigh: string;
  statusMedium: string;
  statusDone: string;
}

export const colors: { light: ColorScheme; dark: ColorScheme } = {
  light: {
    background: '#f7f8fa',
    surface: '#ffffff',
    surfaceMuted: '#eef0f4',
    border: '#d9dde5',
    text: '#141821',
    textMuted: '#4f5868',
    primary: '#1f4fd1',
    primaryText: '#ffffff',
    statusOverdue: '#c62828',
    statusHigh: '#c05600',
    statusMedium: '#1f5fbf',
    statusDone: '#1b7a3d',
  },
  dark: {
    background: '#0f1218',
    surface: '#171b23',
    surfaceMuted: '#20252f',
    border: '#2e3440',
    text: '#eef1f6',
    textMuted: '#a7b0c0',
    primary: '#7aa2ff',
    primaryText: '#0b1020',
    statusOverdue: '#ff7b7b',
    statusHigh: '#ffab5e',
    statusMedium: '#7fb2ff',
    statusDone: '#5fd38b',
  },
};

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** يولّد متغيرات CSS للوضعين الفاتح والداكن. */
export function toCssVariables(): string {
  const block = (scheme: ColorScheme) =>
    Object.entries(scheme)
      .map(([k, v]) => `  --color-${kebab(k)}: ${v};`)
      .join('\n');
  const shared = [
    `  --font-sans: ${fontFamily.sans};`,
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v}px;`),
    `  --touch-target: ${minTouchTarget}px;`,
  ].join('\n');
  return [
    '/* مولّد آلياً من @trend/ui/src/tokens.ts — لا تعدّله يدوياً */',
    `:root {\n${shared}\n${block(colors.light)}\n  color-scheme: light;\n}`,
    `:root[data-theme='dark'] {\n${block(colors.dark)}\n  color-scheme: dark;\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${block(
      colors.dark,
    )
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')}\n    color-scheme: dark;\n  }\n}`,
    '',
  ].join('\n\n');
}
