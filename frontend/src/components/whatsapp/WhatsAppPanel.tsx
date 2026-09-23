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
 * Mounted ONCE by AppShell and then kept alive for the rest of the session —
 * hidden with CSS when the operator is on another page, never unmounted.
 * WhatsApp Web takes roughly ten seconds to boot and re-runs its whole
 * handshake on every load, so unmounting it on navigation (the natural
 * outcome of putting it behind a route) would make every visit feel broken
 * and would interrupt an in-flight send.
 *
 * It is also mounted lazily: an operator who never opens this page never pays
 * the load cost, and no WhatsApp connection is opened behind their back.
 */
export function WhatsAppPanel({ active }: { active: boolean }) {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const [loading, setLoading] = useState(true);
  // Latches on first activation and never clears — this is what keeps the
  // session alive across navigation once the operator has opened it.
  const [everActivated, setEverActivated] = useState(false);
  const available = isWhatsAppEmbedAvailable();

  useEffect(() => {
    if (active) setEverActivated(true);
  }, [active]);

  // Billing pages ask for a specific chat via the module-level channel in
  // lib/whatsappWeb.ts. Requests made before this panel exists are queued
  // there and replayed the moment it subscribes, so the very first
  // "Send on WhatsApp" — which mounts this component *and* asks it to open a
  // chat in the same tick — is not lost.
  useEffect(() => {
    if (!everActivated) return;
    return subscribeToWhatsAppChatRequests(({ phone, caption }) => {
      const view = webviewRef.current;
      if (!view) return;
      // loadURL rather than setting src: src only triggers a navigation when
      // the value actually changes, so sending two bills to the same number
      // in a row would silently do nothing the second time.
      void view.loadURL(buildWhatsAppChatUrl(phone, caption)).catch(() => {
        /* a navigation the guest refuses is surfaced by the page itself */
      });
    });
  }, [everActivated]);

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
  }, [everActivated]);

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
    <div className={active ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'}>
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

      {/* Only rendered once the page has actually been opened — see
          everActivated above. Kept mounted from then on. */}
      {everActivated && (
        <webview
          ref={webviewRef as React.Ref<HTMLElement>}
          src={WHATSAPP_HOME_URL}
          // The whole point: Electron persists cookies/IndexedDB for this
          // partition in the user profile, so the link survives restarts.
          // Must match WHATSAPP_PARTITION in desktop/main.js.
          partition="persist:whatsapp"
          className="flex-1 w-full"
        />
      )}
    </div>
  );
}
