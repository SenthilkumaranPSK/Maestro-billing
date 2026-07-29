import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Receipt, Users, Package, ListChecks, History, Settings, FileSpreadsheet, ArrowLeftRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/dashboard',  icon: LayoutDashboard,  label: 'Dashboard' },
  { to: '/billing',    icon: Receipt,          label: 'New Bill' },
  { to: '/customers',  icon: Users,            label: 'Customers' },
  { to: '/products',   icon: Package,          label: 'Products' },
  { to: '/services',   icon: ListChecks,       label: 'Services' },
  { to: '/history',    icon: History,          label: 'Bill History' },
  { to: '/settings',   icon: Settings,         label: 'Settings' },
];

// MM is a wholly separate billing area — own dashboard, own product catalog,
// own customer database, own MM/YY-YY/NNN numbering, own history, own
// settings. It gets its own complete sidebar (see MmSidebar below), not a
// few links tacked onto the studio's normal one.
const mmNav = [
  { to: '/mm-dashboard', icon: LayoutDashboard,  label: 'MM Dashboard' },
  { to: '/mm-billing',   icon: Receipt,          label: 'MM Bill' },
  { to: '/mm-products',  icon: FileSpreadsheet,  label: 'MM Product' },
  { to: '/mm-customers', icon: Users,            label: 'MM Customer' },
  { to: '/mm-history',   icon: History,          label: 'MM History' },
  { to: '/mm-settings',  icon: Settings,         label: 'MM Settings' },
];

function NavItem({ to, icon: Icon, label }: { to: string; icon: typeof LayoutDashboard; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-brand-500 text-primary-foreground shadow-soft'
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 hover:translate-x-1',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              'w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110',
              isActive ? 'text-primary-foreground' : 'text-slate-400',
            )}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

/** The studio's normal Thermal/A4 billing sidebar. */
function MainSidebar() {
  return (
    <aside className="w-60 min-h-screen bg-white border-r border-slate-100 flex flex-col">
      <div className="px-5 py-7 bg-gradient-to-b from-brand-50 to-white border-b border-slate-100 flex justify-center items-center">
        <img src="/Logo.png" alt="Logo" className="h-14 w-full object-contain" />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {nav.map((item) => <NavItem key={item.to} {...item} />)}
      </nav>

      {/* Single switch point into the MM area — mirrors MmSidebar's own
          switch-back button at the bottom. */}
      <div className="p-3 border-t border-slate-100">
        <NavLink
          to="/mm-dashboard"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all duration-200"
        >
          <ArrowLeftRight className="w-4 h-4 shrink-0 text-slate-400" />
          Switch to MM
        </NavLink>
      </div>
    </aside>
  );
}

/** MM's own fully separate sidebar — own nav, own visual identity, with a
 * single switch-back point (the Maestro Studio logo) at the bottom-left. */
function MmSidebar() {
  return (
    <aside className="w-60 min-h-screen bg-white border-r border-slate-100 flex flex-col">
      <div className="px-5 py-7 bg-gradient-to-b from-slate-100 to-white border-b border-slate-100 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tracking-tight text-slate-800">MM</span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mt-0.5">Billing Area</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {mmNav.map((item) => <NavItem key={item.to} {...item} />)}
      </nav>

      {/* Maestro Studio logo — the way back to the studio's normal billing
          area, always visible at the bottom-left of the MM sidebar. */}
      <NavLink
        to="/dashboard"
        title="Switch to Maestro Billing"
        className="flex items-center gap-2.5 px-4 py-4 border-t border-slate-100 hover:bg-slate-50 transition-colors"
      >
        <img src="/Logo.png" alt="Maestro Billing" className="h-8 w-8 object-contain shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-700 truncate">Maestro Billing</p>
          <p className="text-[10px] text-slate-400">Switch back</p>
        </div>
      </NavLink>
    </aside>
  );
}

export function Sidebar() {
  const location = useLocation();
  const inMmArea = location.pathname.startsWith('/mm-');
  return inMmArea ? <MmSidebar /> : <MainSidebar />;
}
