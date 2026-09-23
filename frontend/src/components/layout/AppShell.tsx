import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { WhatsAppPanel } from '@/components/whatsapp/WhatsAppPanel';

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
  '/whatsapp':   'WhatsApp',
  '/settings':   'Settings',
};

/**
 * Wraps a page in the entrance fade-up, then drops the animation class once
 * it finishes. `.animate-fade-up`'s keyframe ends on `transform: translateY(0)`
 * with `fill-mode: both`, which — even though visually identical to no
 * transform — never resolves back to the CSS keyword `none`, so it stays
 * applied indefinitely and silently becomes the containing block for any
 * `position: fixed` element nested inside it (any page modal: Edit, Preview,
 * bill detail, ledger, password gate — all plain fixed-inset-0 divs, not
 * portaled). That pins those modals to the page's own scrollable content box
 * instead of the viewport — invisible on a short page, but on a long one
 * (many bill rows) it centers the modal within the *full* content height and
 * lands it far below the fold. `key={pathname}` on this component (not just
 * on a div inside it) makes `animating` reset to `true` fresh on every
 * navigation via a new component instance, so the fade-up still replays.
 */
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
  const title = titles[pathname] ?? 'Photo Studio Billing';
  // The WhatsApp panel is a sibling of <main>, not a routed page, and is only
  // hidden — never unmounted — when the operator navigates elsewhere. See the
  // component for why (WhatsApp Web is slow to boot and re-handshakes on every
  // load, so a route-owned instance would reconnect on every single visit).
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
