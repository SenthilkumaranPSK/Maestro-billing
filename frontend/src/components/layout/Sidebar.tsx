import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Receipt, Users, Package, ListChecks, History, Settings,
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

export function Sidebar() {
  return (
    <aside className="w-60 min-h-screen bg-white border-r border-slate-100 flex flex-col">
      {/* Brand */}
      <div className="px-5 py-7 bg-gradient-to-b from-brand-50 to-white border-b border-slate-100 flex justify-center items-center">
        <img src="/Logo.png" alt="Logo" className="h-14 w-full object-contain" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
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
        ))}
      </nav>
    </aside>
  );
}
