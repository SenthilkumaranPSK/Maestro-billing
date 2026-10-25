import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  Users,
  Package,
  History,
  Settings,
  MessageCircle,
  CalendarDays,
  FileSpreadsheet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItemDef {
  to: string;
  aliases?: string[];
  icon: typeof LayoutDashboard;
  label: string;
}

const navItems: NavItemDef[] = [
  { to: '/dashboard', aliases: ['/mm-dashboard'], icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/billing', aliases: ['/mm-billing'], icon: Receipt, label: 'New Bill' },
  { to: '/products', aliases: ['/mm-products'], icon: Package, label: 'Products & Stock' },
  { to: '/customers', aliases: ['/mm-customers'], icon: Users, label: 'Customers' },
  { to: '/history', aliases: ['/mm-history'], icon: History, label: 'Bill History' },
  { to: '/day-report', aliases: ['/mm-day-report'], icon: CalendarDays, label: 'Day Report' },
  { to: '/month-report', aliases: ['/mm-month-report'], icon: FileSpreadsheet, label: 'Month Report' },
  { to: '/gst-report', aliases: ['/mm-gst-report'], icon: FileSpreadsheet, label: 'GST Report' },
  { to: '/whatsapp', icon: MessageCircle, label: 'WhatsApp' },
  { to: '/settings', aliases: ['/mm-settings'], icon: Settings, label: 'Settings' },
];

function NavItem({ item, currentPath }: { item: NavItemDef; currentPath: string }) {
  const Icon = item.icon;
  const isMatch = currentPath === item.to || (item.aliases && item.aliases.includes(currentPath));

  return (
    <NavLink
      to={item.to}
      className={cn(
        'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
        isMatch
          ? 'bg-brand-500 text-white shadow-soft font-semibold'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:translate-x-1',
      )}
    >
      <Icon
        className={cn(
          'w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110',
          isMatch ? 'text-white' : 'text-slate-400',
        )}
      />
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-slate-100 flex flex-col">
      {/* Brand Header */}
      <div className="px-5 py-5 border-b border-slate-100 flex items-center gap-3 bg-gradient-to-b from-red-50/50 to-white">
        <img
          src="/mm-logo.png"
          alt="Moru Moru Snacks"
          className="h-12 w-auto max-w-full object-contain"
        />
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => (
          <NavItem key={item.to} item={item} currentPath={location.pathname} />
        ))}
      </nav>

      {/* Footer System Info */}
      <div className="p-3 border-t border-slate-100 text-center">
        <p className="text-[11px] font-semibold text-slate-700 tracking-wide">MM BILLING SYSTEM</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Sree Meenakshi Enterprises</p>
      </div>
    </aside>
  );
}
