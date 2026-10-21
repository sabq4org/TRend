'use client';

import { useTranslations } from 'next-intl';
import { useState, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: string;
  aside?: ReactNode;
}

export const inputClass =
  'h-12 w-full rounded-[10px] border border-border bg-surface px-3.5 text-[15px] text-fg ' +
  'focus:border-primary focus:outline-2 focus:outline-offset-1 focus:outline-primary';

export function PasswordField({ id, label, aside, ...input }: Props) {
  const t = useTranslations('auth');
  const [reveal, setReveal] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          dir="ltr"
          className={`${inputClass} pe-14`}
          {...input}
        />
        <button
          type="button"
          onClick={() => setReveal(!reveal)}
          aria-label={reveal ? t('hidePassword') : t('showPassword')}
          aria-pressed={reveal}
          className="absolute end-0.5 top-0.5 flex size-11 items-center justify-center rounded-lg text-fg-muted"
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
