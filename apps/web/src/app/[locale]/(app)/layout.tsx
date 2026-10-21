import type { ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';

// §10.3: هيكل التطبيق بعد الدخول (شريط جانبي ومحتوى).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
