import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/AuthGate';
import { Sidebar } from '@/components/Sidebar';

// §10.3: هيكل التطبيق بعد الدخول (شريط جانبي ومحتوى)، لمن سجّل الدخول فقط.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <div className="flex min-h-dvh">
        <Sidebar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </AuthGate>
  );
}
