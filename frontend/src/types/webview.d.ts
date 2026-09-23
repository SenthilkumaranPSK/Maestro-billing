/**
 * Minimal typings for Electron's <webview> tag (used only by the embedded
 * WhatsApp panel). React has no built-in JSX type for it, and pulling in the
 * full `electron` package purely for this one element would drag Node/Electron
 * types into a browser-only tsconfig. Only the members this app touches are
 * declared.
 *
 * NOTE: this augments React's OWN JSX namespace, not a bare `declare global
 * { namespace JSX }`. Under `jsx: "react-jsx"` the global form does not merge
 * with React's — it shadows it, and every render-prop component in the app
 * (NavLink's `{({ isActive }) => …}` first) silently loses its inference and
 * fails with implicit-any. Keep the augmentation where it is.
 */
export interface ElectronWebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  getURL(): string;
  isLoading(): boolean;
  canGoBack(): boolean;
  goBack(): void;
  openDevTools(): void;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          /** Persistent session partition — this is what keeps the WhatsApp
           * login alive across app restarts. Must match WHATSAPP_PARTITION
           * in desktop/main.js. */
          partition?: string;
          allowpopups?: string;
          useragent?: string;
        },
        HTMLElement
      >;
    }
  }
}
