/**
 * Embedded WhatsApp Web — the browser-side half.
 *
 * The desktop app hosts https://web.whatsapp.com in an Electron <webview> on
 * a persistent session partition (see `configureWhatsAppGuest` in
 * desktop/main.js). That replaces the old approach of driving WhatsApp from
 * the backend with puppeteer + whatsapp-web.js, which could never persist a
 * login: LocalAuth saves a session via puppeteer's `userDataDir` *launch*
 * option, but the service handed whatsapp-web.js a WS endpoint, which takes
 * puppeteer.connect() — and that ignores launch options entirely. The
 * session folder was created and never written to, so every restart demanded
 * a fresh QR scan.
 *
 * Here the operator scans once and Electron persists the session the same way
 * a normal browser does.
 */

/** Phone → WhatsApp's wire format, matching the backend's own normalisation
 * in WhatsAppService.sendPdfInvoice: digits only, and a bare 10-digit Indian
 * number gets the 91 country code. Anything already carrying a country code
 * is left alone. */
export function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

/** The deep link that opens one customer's chat with the caption pre-typed.
 * WhatsApp Web reads both params and lands directly in the conversation, so
 * the operator never searches for the number by hand. */
export function buildWhatsAppChatUrl(phone: string, text?: string): string {
  const number = normalizeWhatsAppPhone(phone);
  const params = new URLSearchParams({ phone: number });
  if (text) params.set('text', text);
  return `https://web.whatsapp.com/send?${params.toString()}`;
}

export const WHATSAPP_HOME_URL = 'https://web.whatsapp.com';

/**
 * True only inside the packaged desktop app. A <webview> needs
 * `webviewTag: true` on the host window, which only desktop/main.js sets —
 * in a plain browser (dev via Vite, or the two-PC client opened in Chrome)
 * the element is unknown and would silently render as an empty inline box,
 * so every caller must branch on this rather than assume.
 */
export function isWhatsAppEmbedAvailable(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const ua = window.navigator.userAgent;
  // Electron keeps its own token in the host window's UA (only the WhatsApp
  // guest gets the stripped Chrome UA — see whatsappUserAgent()), so this
  // stays a reliable marker for "we are inside the desktop shell".
  if (!/Electron\//.test(ua)) return false;
  // Belt and braces: an Electron build without webviewTag creates a plain
  // HTMLUnknownElement for this tag.
  return !(document.createElement('webview') instanceof HTMLUnknownElement);
}

/**
 * A one-slot request channel between a billing page and the WhatsApp panel.
 *
 * The panel is mounted once at the AppShell level and deliberately never
 * unmounts (WhatsApp Web costs ~10s to load and would re-handshake on every
 * route change), so a billing page cannot reach it through props or context
 * without threading state through the whole shell. A module-level subscriber
 * keeps that coupling to two small functions.
 *
 * The pending request is retained until the panel consumes it, so "open the
 * chat" still works on the very first visit, when the panel is being mounted
 * lazily in response to this same navigation and no subscriber exists yet.
 */
export interface WhatsAppChatRequest {
  phone: string;
  caption?: string;
}

type Listener = (request: WhatsAppChatRequest) => void;

let listener: Listener | null = null;
let pending: WhatsAppChatRequest | null = null;

export function requestWhatsAppChat(request: WhatsAppChatRequest): void {
  if (listener) listener(request);
  else pending = request;
}

export function subscribeToWhatsAppChatRequests(fn: Listener): () => void {
  listener = fn;
  if (pending) {
    const queued = pending;
    pending = null;
    fn(queued);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}
