import type { ReactNode } from 'react';

/** رسالة خطأ تُقرأ فور ظهورها (§10.5). */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[10px] border border-overdue/30 bg-overdue/10 px-3.5 py-3 text-sm leading-relaxed"
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
        className="mt-px shrink-0 text-overdue"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

export const primaryButton =
  'flex h-12 items-center justify-center rounded-[10px] bg-primary text-base font-semibold text-on-primary disabled:opacity-60';
