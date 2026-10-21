import { describe, expect, it } from 'vitest';
import { colors, contrastRatio, toCssVariables } from './index';

describe('design tokens (§10.1, NFR-12)', () => {
  for (const mode of ['light', 'dark'] as const) {
    const c = colors[mode];
    const pairs: [string, string, string][] = [
      ['text/background', c.text, c.background],
      ['text/surface', c.text, c.surface],
      ['textMuted/surface', c.textMuted, c.surface],
      ['primaryText/primary', c.primaryText, c.primary],
      ['overdue/surface', c.statusOverdue, c.surface],
      ['high/surface', c.statusHigh, c.surface],
      ['medium/surface', c.statusMedium, c.surface],
      ['done/surface', c.statusDone, c.surface],
    ];
    for (const [name, fg, bg] of pairs) {
      it(`${mode} ${name} meets 4.5:1`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('emits light and dark CSS variables', () => {
    const css = toCssVariables();
    expect(css).toContain('--color-status-overdue');
    expect(css).toContain(":root[data-theme='dark']");
  });
});
