import { describe, expect, it } from 'vitest';
import { renderMail } from './templates';

describe('renderMail', () => {
  const invitation = {
    template: 'invitation' as const,
    payload: {
      name: '<b>هدى</b>',
      inviter: 'نورة & فريقها',
      workspace: 'الأخبار',
      role: 'admin' as const,
      url: 'https://app.trend.sa/ar/invite/abc?x="1"',
      expiresAt: '2026-10-28T09:00:00.000Z',
    },
  };

  it('escapes names and links in the HTML but keeps them readable in the text', () => {
    const { html, text } = renderMail('ar', invitation);
    expect(html).toContain('&lt;b&gt;هدى&lt;/b&gt;');
    expect(html).not.toContain('<b>هدى</b>');
    expect(html).toContain('نورة &amp; فريقها');
    expect(html).toContain('href="https://app.trend.sa/ar/invite/abc?x=&quot;1&quot;"');
    expect(text).toContain('مرحباً <b>هدى</b>،');
  });

  it('shows the expiry in Riyadh time with the Gregorian calendar and western digits', () => {
    const { text } = renderMail('ar', invitation);
    expect(text).toContain('بدور مشرف');
    expect(text).toMatch(/28 أكتوبر 2026/);
    expect(text).toMatch(/12:00/);
  });

  it('writes English left to right', () => {
    const { html, subject } = renderMail('en', {
      template: 'password_reset',
      payload: { name: 'Omar', url: 'https://app.trend.sa/en/reset-password?token=t' },
    });
    expect(subject).toBe('Reset your TRend password');
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('within 30 minutes');
  });
});
