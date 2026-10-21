import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { directionOf, messages, normalizeArabic, toNumerals } from './index';

describe('normalizeArabic (§10.2)', () => {
  it('removes diacritics and tatweel', () => {
    expect(normalizeArabic('مُهِمَّةٌ')).toBe('مهمه');
    expect(normalizeArabic('مـــهـمة')).toBe('مهمه');
  });

  it('unifies hamza forms, taa marbuta and alef maqsura', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(normalizeArabic('إدارة')).toBe('اداره');
    expect(normalizeArabic('آخر')).toBe('اخر');
    expect(normalizeArabic('مستشفى')).toBe('مستشفي');
    expect(normalizeArabic('مسؤول')).toBe('مسوول');
  });

  it('collapses whitespace and lowercases latin', () => {
    expect(normalizeArabic('  حملة   Launch ')).toBe('حمله launch');
  });
});

describe('toNumerals (§10.2)', () => {
  it('converts both ways', () => {
    expect(toNumerals('2026-10-21', 'arab')).toBe('٢٠٢٦-١٠-٢١');
    expect(toNumerals('٢٠٢٦', 'latn')).toBe('2026');
  });
});

describe('locales', () => {
  it('derives direction', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  it('supports the six Arabic plural forms (§10.2)', () => {
    const fmt = new IntlMessageFormat(messages.ar.common.tasksCount, 'ar');
    expect(fmt.format({ count: 0 })).toBe('لا مهام');
    expect(fmt.format({ count: 1 })).toBe('مهمة واحدة');
    expect(fmt.format({ count: 2 })).toBe('مهمتان');
    expect(fmt.format({ count: 3 })).toBe('3 مهام');
    expect(fmt.format({ count: 11 })).toBe('11 مهمة');
    expect(fmt.format({ count: 100 })).toBe('100 مهمة');
  });
});
