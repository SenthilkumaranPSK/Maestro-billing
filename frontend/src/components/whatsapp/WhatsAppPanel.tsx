import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, MessageCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  WHATSAPP_HOME_URL,
  buildWhatsAppChatUrl,
  isWhatsAppEmbedAvailable,
  subscribeToWhatsAppChatRequests,
} from '@/lib/whatsappWeb';
import type { ElectronWebviewElement } from '@/types/webview';

/**
 * WhatsApp Web, hosted inside the desktop app on a persistent session.
 *
 * Mounted ONCE by AppShell and kept alive in the background so the WhatsApp session
 * is immediately available for background bill dispatches, without jarring screen transitions.
 * When the operator is on another page, it sits off-screen with full layout dimensions
 * so CDP coordinate calculations remain valid and messages commit seamlessly.
 */
export function WhatsAppPanel({ active }: { active: boolean }) {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const [loading, setLoading] = useState(true);
  const available = isWhatsAppEmbedAvailable();

  // Billing pages ask for a specific chat via the module-level channel in lib/whatsappWeb.ts.
  useEffect(() => {
    if (!available) return;
    return subscribeToWhatsAppChatRequests(({ phone, caption }) => {
      const view = webviewRef.current;
      if (!view) return;
      void view.loadURL(buildWhatsAppChatUrl(phone, caption)).catch(() => {
        /* a navigation the guest refuses is surfaced by the page itself */
      });
    });
  }, [available]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return;
    const start = () => setLoading(true);
    const stop = () => setLoading(false);
    view.addEventListener('did-start-loading', start);
    view.addEventListener('did-stop-loading', stop);
    return () => {
      view.removeEventListener('did-start-loading', start);
      view.removeEventListener('did-stop-loading', stop);
    };
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
          ? 'flex-1 flex flex-col overflow-hidden relative'
          : 'fixed -left-[9999px] top-0 w-[1280px] h-[800px] pointer-events-none opacity-0 -z-50'
      }
      aria-hidden={!active}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <MessageCircle className="w-4 h-4 text-brand-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700">WhatsApp</span>
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading…
          </span>
        )}
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

      <webview
        ref={webviewRef as React.Ref<HTMLElement>}
        src={WHATSAPP_HOME_URL}
        partition="persist:whatsapp"
        className="flex-1 w-full"
      />
    </div>
  );
}
