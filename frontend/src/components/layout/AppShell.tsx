import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { WhatsAppPanel } from '@/components/whatsapp/WhatsAppPanel';

const titles: Record<string, string> = {
  '/dashboard': 'MM Dashboard',
  '/billing': 'MM Tax Invoice',
  '/customers': 'MM Customers',
  '/products': 'MM Products & Stock',
  '/history': 'MM Bill History',
  '/day-report': 'Day Report',
  '/month-report': 'Month Report',
  '/gst-report': 'GST Report',
  '/whatsapp': 'WhatsApp',
  '/settings': 'MM Settings',
  '/mm-dashboard': 'MM Dashboard',
  '/mm-billing': 'MM Tax Invoice',
  '/mm-customers': 'MM Customers',
  '/mm-products': 'MM Products & Stock',
  '/mm-history': 'MM Bill History',
  '/mm-day-report': 'Day Report',
  '/mm-month-report': 'Month Report',
  '/mm-gst-report': 'GST Report',
  '/mm-settings': 'MM Settings',
};

function FadeUpPage({ children }: { children: React.ReactNode }) {
  const [animating, setAnimating] = useState(true);
  return (
    <div
      className={animating ? 'animate-fade-up' : undefined}
      onAnimationEnd={() => setAnimating(false)}
    >
      {children}
    </div>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? 'MM Billing';
  const onWhatsApp = pathname === '/whatsapp';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={title} />
        <main className={onWhatsApp ? 'hidden' : 'flex-1 overflow-auto p-7'}>
          <FadeUpPage key={pathname}>
            <Outlet />
          </FadeUpPage>
        </main>
        <WhatsAppPanel active={onWhatsApp} />
      </div>
    </div>
  );
}
