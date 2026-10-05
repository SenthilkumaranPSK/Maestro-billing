import React, { useEffect, useRef } from 'react';
import { RefreshCw, MessageCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  WHATSAPP_HOME_URL,
  buildWhatsAppChatUrl,
  isWhatsAppEmbedAvailable,
  subscribeToWhatsAppChatRequests,
} from '@/lib/whatsappWeb';
import type { ElectronWebviewElement } from '@/types/webview';

/**
 * Stable, isolated WhatsApp Web panel.
 *
 * Mounted once in AppShell. Uses an unmanaged DOM container for the <webview> element
 * so React's virtual DOM reconciliation NEVER touches, re-sets, or reloads the webview's
 * `src` attribute on component re-renders or page navigation.
 */
export const WhatsAppPanel = React.memo(function WhatsAppPanel({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const available = isWhatsAppEmbedAvailable();

  useEffect(() => {
    if (!available || !containerRef.current) return;

    // Create the <webview> DOM node natively ONCE.
    // This prevents React from reconciling its attributes or re-triggering `src` on render.
    if (!webviewRef.current) {
      const webview = document.createElement('webview') as unknown as ElectronWebviewElement;
      webview.setAttribute('src', WHATSAPP_HOME_URL);
      webview.setAttribute('partition', 'persist:whatsapp');
      webview.className = 'flex-1 w-full h-full border-0';
      webviewRef.current = webview;
      containerRef.current.appendChild(webview as unknown as Node);
    }
  }, [available]);

  // Handle programmatic chat opening requests (e.g. from New Bill or History)
  useEffect(() => {
    if (!available) return;
    return subscribeToWhatsAppChatRequests(({ phone, caption }) => {
      const view = webviewRef.current;
      if (!view) return;
      void view.loadURL(buildWhatsAppChatUrl(phone, caption)).catch(() => {});
    });
  }, [available]);

  if (!available) {
    return (
      <div className={active ? 'flex-1 overflow-auto p-7' : 'hidden'}>
        <div className="max-w-xl mx-auto mt-16 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <MessageCircle className="w-10 h-10 mx-auto text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-800">
            Available in the desktop app
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            WhatsApp runs inside the Maestro Billing desktop app, which keeps you
            signed in between restarts. Open this page there to scan the QR code
            and send bills.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        active
          ? 'flex-1 flex flex-col overflow-hidden h-full w-full'
          : 'fixed top-0 left-0 w-[1280px] h-[800px] opacity-0 pointer-events-none -z-50'
      }
      aria-hidden={!active}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 shrink-0">
        <MessageCircle className="w-4 h-4 text-brand-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700">WhatsApp</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => webviewRef.current?.reload()}
            title="Reload WhatsApp"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Reload
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void webviewRef.current?.loadURL(WHATSAPP_HOME_URL).catch(() => {});
            }}
            title="Back to all chats"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            All chats
          </Button>
        </div>
      </div>

      {/* Unmanaged container that holds the persistent <webview> DOM node */}
      <div ref={containerRef} className="flex-1 w-full h-full overflow-hidden flex flex-col" />
    </div>
  );
});

