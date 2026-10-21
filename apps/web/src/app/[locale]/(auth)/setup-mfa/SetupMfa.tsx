'use client';

import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, primaryButton } from '@/components/auth/Alert';
import { inputClass, PasswordField } from '@/components/auth/PasswordField';
import { useRouter } from '@/i18n/routing';
import { AuthError, enableTwoFactor, requestedPath, verifyTotp } from '@/lib/auth-client';

type Step =
  | { name: 'password' }
  | { name: 'scan'; uri: string; secret: string; backupCodes: string[] }
  | { name: 'backup'; backupCodes: string[] };

// §9.2: تفعيل TOTP، إلزامي للمالك والمشرف قبل أي استخدام للنظام.
export function SetupMfa() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, invalidMessage: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof AuthError && err.kind === 'invalid' ? invalidMessage : t('unexpected'),
      );
    } finally {
      setBusy(false);
    }
  }

  function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    void run(async () => {
      const { totpURI, backupCodes } = await enableTwoFactor(password);
      const secret = new URL(totpURI).searchParams.get('secret') ?? '';
      setStep({ name: 'scan', uri: totpURI, secret, backupCodes });
    }, t('setupMfa.wrongPassword'));
  }

  function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.name !== 'scan') return;
    const code = String(new FormData(e.currentTarget).get('code')).replace(/\s/g, '');
    void run(async () => {
      await verifyTotp(code);
      setStep({ name: 'backup', backupCodes: step.backupCodes });
    }, t('twoFactor.invalid'));
  }

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-7 rounded-2xl border border-border bg-surface p-9">
      <div className="flex flex-col gap-2.5">
        <span className="self-start rounded-full bg-high/15 px-2.5 py-1 text-[13px] font-semibold">
          {t('setupMfa.badge')}
        </span>
        <h1 className="m-0 text-[26px] font-bold">
          {step.name === 'backup' ? t('setupMfa.backupTitle') : t('setupMfa.title')}
        </h1>
        <p className="m-0 max-w-[600px] text-[15px] leading-relaxed text-fg-muted">
          {step.name === 'backup' ? t('setupMfa.backupBody') : t('setupMfa.subtitle')}
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {step.name === 'password' && (
        <form onSubmit={onPassword} className="flex max-w-[440px] flex-col gap-5">
          <PasswordField
            id="password"
            name="password"
            label={t('setupMfa.confirmPassword')}
            required
            autoComplete="current-password"
          />
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className={`${primaryButton} px-7`}
          >
            {t('setupMfa.start')}
          </button>
        </form>
      )}

      {step.name === 'scan' && (
        <form onSubmit={onCode} className="flex flex-col gap-7">
          <div className="flex flex-wrap items-start gap-8">
            <ol className="m-0 flex min-w-0 flex-[1_1_320px] list-none flex-col gap-5 p-0">
              <Step n={1} title={t('setupMfa.step1Title')}>
                <span className="text-sm leading-relaxed text-fg-muted">
                  {t('setupMfa.step1Body')}
                </span>
              </Step>
              <Step n={2} title={t('setupMfa.step2Title')}>
                <span className="text-sm text-fg-muted">{t('setupMfa.secret')}:</span>
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    dir="ltr"
                    className="rounded-lg bg-surface-muted px-2.5 py-2 font-mono text-sm tracking-wider break-all"
                  >
                    {step.secret}
                  </code>
                  <CopyButton text={step.secret} />
                </div>
              </Step>
              <Step n={3} title={t('setupMfa.step3Title')}>
                <label htmlFor="code" className="sr-only">
                  {t('twoFactor.code')}
                </label>
                <input
                  id="code"
                  name="code"
                  dir="ltr"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  maxLength={7}
                  placeholder="000 000"
                  className={`${inputClass} max-w-[220px] text-center font-mono text-xl tracking-[0.25em]`}
                />
              </Step>
            </ol>
            <QrCode uri={step.uri} label={t('setupMfa.qrLabel')} />
          </div>
          <div className="border-t border-surface-muted pt-6">
            <button
              type="submit"
              disabled={busy}
              aria-busy={busy}
              className={`${primaryButton} px-7`}
            >
              {t('setupMfa.activate')}
            </button>
          </div>
        </form>
      )}

      {step.name === 'backup' && (
        <div className="flex flex-col gap-6">
          <ul
            dir="ltr"
            className="m-0 grid list-none grid-cols-2 gap-2 p-0 font-mono text-[15px] sm:grid-cols-3"
          >
            {step.backupCodes.map((code) => (
              <li key={code} className="rounded-lg bg-surface-muted px-3 py-2 text-center">
                {code}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <CopyButton text={step.backupCodes.join('\n')} />
            <button
              type="button"
              onClick={() => router.push(requestedPath() ?? '/')}
              className={`${primaryButton} px-7`}
            >
              {t('setupMfa.done')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-bold"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <strong className="text-[15px]">{title}</strong>
        {children}
      </div>
    </li>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useTranslations('auth.setupMfa');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
      className="h-11 rounded-lg border border-border bg-surface px-3.5 text-sm"
    >
      <span aria-live="polite">{copied ? t('copied') : t('copy')}</span>
    </button>
  );
}

function QrCode({ uri, label }: { uri: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(uri, { margin: 1, width: 200 }).then(setSrc);
  }, [uri]);
  return (
    <div className="flex flex-[0_0_200px] justify-center rounded-xl bg-white p-2">
      {/* رمز يُولَّد محلياً من رابط otpauth؛ لا يُرسل السر لأي خدمة خارجية. */}
      {src ? (
        <img src={src} alt={label} width={184} height={184} />
      ) : (
        <div className="size-[184px]" />
      )}
    </div>
  );
}
