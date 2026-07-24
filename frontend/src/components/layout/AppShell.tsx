import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

const titles: Record<string, string> = {
  '/dashboard':  'Dashboard',
  '/billing':    'New Bill',
  '/customers':  'Customers',
  '/products':   'Products',
  '/services':   'Services',
  '/history':    'Bill History',
  '/day-report': 'Day Report',
  '/month-report': 'Month Report',
  '/gst-report': 'GST Report',
  '/settings':   'Settings',
};

export function AppShell() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? 'Photo Studio Billing';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={title} />
        <main className="flex-1 overflow-auto p-7">
          {/* key={pathname} remounts the wrapper on navigation so every page
              enters with the same soft fade-up. */}
          <div key={pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
