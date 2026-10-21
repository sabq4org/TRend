import { messages, type Locale } from '@trend/i18n';
import { IntlMessageFormat } from 'intl-messageformat';

// §10.2: رسائل البريد بلغة المستلم، والعربية من اليمين لليسار. النصوص في @trend/i18n
// تحت mail، فيفحصها i18n:check مع بقية الواجهة.

export const PASSWORD_RESET_TTL_MINUTES = 30;

export type MailMessage =
  | { template: 'password_reset'; payload: { name: string; url: string } }
  | {
      template: 'invitation';
      payload: {
        name: string;
        inviter: string;
        workspace: string;
        role: 'owner' | 'admin' | 'member' | 'guest';
        url: string;
        expiresAt: string;
      };
    };

export type MailTemplate = MailMessage['template'];

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function format(locale: Locale, pattern: string, values: Record<string, string | number> = {}) {
  return String(new IntlMessageFormat(pattern, locale).format(values));
}

/** تاريخ الانتهاء بالتقويم الميلادي والأرقام الغربية (الافتراض الحالي، §10.2) بتوقيت الرياض. */
function formatDate(locale: Locale, iso: string) {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(iso));
}

export function renderMail(locale: Locale, message: MailMessage): RenderedMail {
  const m = messages[locale];
  const t = (pattern: string, values?: Record<string, string | number>) =>
    format(locale, pattern, values);

  let subject: string;
  let paragraphs: string[];
  let action: string;
  let after: string;
  const { url } = message.payload;

  if (message.template === 'password_reset') {
    const s = m.mail.passwordReset;
    subject = s.subject;
    paragraphs = [
      t(s.greeting, { name: message.payload.name }),
      t(s.body, { minutes: PASSWORD_RESET_TTL_MINUTES }),
    ];
    action = s.action;
    after = s.ignore;
  } else {
    const s = m.mail.invitation;
    const p = message.payload;
    const values = { inviter: p.inviter, workspace: p.workspace, role: m.roles[p.role] };
    subject = t(s.subject, values);
    paragraphs = [t(s.greeting, { name: p.name }), t(s.body, values)];
    action = s.action;
    after = t(s.expiry, { expires: formatDate(locale, p.expiresAt) });
  }

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const text = [...paragraphs, '', `${action}: ${url}`, '', after, '', '—', m.mail.footer].join(
    '\n',
  );

  const p = (s: string, extra = '') =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#141821;${extra}">${escape(s)}</p>`;
  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f7f8fa;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;">
<div dir="${dir}" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d9dde5;border-radius:16px;padding:32px;text-align:${align};">
<div style="font-size:20px;font-weight:700;color:#1f4fd1;margin-bottom:24px;">${escape(m.app.name)}</div>
${paragraphs.map((s) => p(s)).join('\n')}
<p style="margin:24px 0;"><a href="${escape(url)}" style="display:inline-block;background:#1f4fd1;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 24px;border-radius:10px;">${escape(action)}</a></p>
${p(after, 'font-size:14px;color:#4f5868;')}
${p(m.mail.linkFallback, 'font-size:13px;color:#4f5868;margin-bottom:4px;')}
<p dir="ltr" style="margin:0 0 24px;font-size:13px;word-break:break-all;text-align:left;"><a href="${escape(url)}" style="color:#1f4fd1;">${escape(url)}</a></p>
<p style="margin:0;font-size:12px;color:#4f5868;border-top:1px solid #eef0f4;padding-top:16px;">${escape(m.mail.footer)}</p>
</div>
</body>
</html>`;

  return { subject, html, text };
}
