import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { executablePath } from 'puppeteer';

puppeteer.use(StealthPlugin());

/** Races a promise against a timeout so a stuck Chrome/CDP call can't hang forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Find a Chromium-based browser on this machine. On a customer PC there is no
 * puppeteer-downloaded Chrome, so look for installed Chrome first and fall
 * back to Edge (preinstalled on every Windows 10/11). Dev machines fall
 * through to puppeteer's own download as a last resort.
 */
function findBrowserPath(): string | null {
  const pf = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] ?? '';
  const candidates = [
    process.env.CHROME_PATH,
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  try {
    const p = executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    // puppeteer has no downloaded browser — nothing more to try
  }
  return null;
}

export type WhatsAppStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED';

// This launches a second, complete Chrome/Edge instance to drive WhatsApp
// Web — genuinely heavy to cold-start (a real browser engine loading a
// JS-heavy web app), on top of Electron's own Chromium UI. Starting it
// synchronously in the constructor used to mean it began at module load,
// before the server even started listening — competing directly with
// Electron's window creation and the frontend's first paint for CPU at
// exactly the moment "opening the app" is most latency-sensitive. WhatsApp
// reconnection/session-resume already takes 10-30s+ on its own, so a short
// delay here costs nothing real while letting the UI become interactive first.
const WHATSAPP_INIT_DELAY_MS = 5000;

// How long WhatsApp may go WITHOUT any sync progress after authenticating
// before it's treated as genuinely stuck (see armReadyWatchdog). Generous on
// purpose: it only has to outlast the gap between two 'loading_screen'
// ticks, not the whole sync, so a slow-but-alive link is never interrupted.
const READY_STALL_TIMEOUT_MS = 180_000;

// Hard ceiling on the whole authenticated→ready wait, however much progress
// is reported. Without it a client that keeps emitting 'loading_screen' but
// never reaches 'ready' leaves the UI on "Starting WhatsApp…" forever.
const READY_ABSOLUTE_TIMEOUT_MS = 600_000;

export class WhatsAppService {
  client: Client | null = null;
  private status: WhatsAppStatus = 'DISCONNECTED';
  private qrCodeData: string | null = null;
  // The Chrome instance we launch ourselves (see initialize). Tracked so
  // re-initialization closes the old browser instead of leaking a process
  // on every reconnect.
  private browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  private initializing = false;
  private shuttingDown = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  // Guards the authenticated -> ready gap (see the 'authenticated' handler).
  private readyWatchdog: NodeJS.Timeout | null = null;
  // When 'authenticated' fired, for the absolute ceiling in armReadyWatchdog.
  // Null whenever we are not in the authenticated→ready window.
  private authenticatedAt: number | null = null;
  // Tracks the in-flight initialize() call so shutdown() can wait for it —
  // otherwise a browser that doInitialize() is mid-launch on assigns itself
  // to this.browser *after* shutdown already closed everything, leaking it.
  private initPromise: Promise<void> | null = null;

  constructor() {
    setTimeout(() => this.initialize(), WHATSAPP_INIT_DELAY_MS);
  }

  private initialize(): Promise<void> {
    // The 'disconnected' retry timer can fire while a previous initialize is
    // still in flight — never run two at once or Chrome instances pile up.
    if (this.initializing) return this.initPromise ?? Promise.resolve();
    this.initializing = true;
    this.initPromise = this.doInitialize().finally(() => {
      this.initializing = false;
      this.initPromise = null;
    });
    return this.initPromise;
  }

  /** Leaves the authenticated→ready window: stops the fuse AND forgets when
   * it started, so the absolute ceiling never leaks into the next attempt. */
  private clearReadyWatchdog() {
    if (this.readyWatchdog) {
      clearTimeout(this.readyWatchdog);
      this.readyWatchdog = null;
    }
    this.authenticatedAt = null;
  }

  /**
   * (Re)starts the authenticated→ready stall timer.
   *
   * This deliberately measures time since the last sign of PROGRESS, not
   * time since 'authenticated'. The first version measured the latter, on a
   * 2-minute fuse, which broke the case it was meant to protect: linking a
   * busy account (or resuming one with a lot of history) legitimately takes
   * longer than 2 minutes, so the timer fired mid-sync and tore the client
   * down. LocalAuth was still part-way through writing the session, so the
   * restart came back with an unusable/empty session folder and served a
   * fresh QR — the operator scans, waits, gets another QR, forever, which
   * reads as "WhatsApp is broken" and is strictly worse than the original
   * hang. whatsapp-web.js emits 'loading_screen' throughout that window, so
   * a tick there is proof it is still working and the fuse is reset.
   *
   * A progress-only fuse can still be starved forever, though, by a client
   * that keeps emitting 'loading_screen' without ever reaching 'ready' —
   * which shows up as "Starting WhatsApp…" and no further updates, with no
   * QR to fall back to and no way out but restarting the app. So there is
   * also an absolute ceiling measured from 'authenticated': progress buys
   * time, but not unlimited time.
   */
  private armReadyWatchdog() {
    if (this.readyWatchdog) clearTimeout(this.readyWatchdog);
    if (this.authenticatedAt == null) this.authenticatedAt = Date.now();

    const elapsed = Date.now() - this.authenticatedAt;
    const remainingCeiling = READY_ABSOLUTE_TIMEOUT_MS - elapsed;
    if (remainingCeiling <= 0) {
      console.warn(
        `WhatsApp never became ready within ${READY_ABSOLUTE_TIMEOUT_MS / 1000}s of authenticating — reinitializing`,
      );
      this.scheduleReconnect();
      return;
    }

    const delay = Math.min(READY_STALL_TIMEOUT_MS, remainingCeiling);
    this.readyWatchdog = setTimeout(() => {
      this.readyWatchdog = null;
      console.warn(
        `WhatsApp stalled between authenticated and ready (no progress for ${delay / 1000}s) — reinitializing`,
      );
      this.scheduleReconnect();
    }, delay);
  }

  /** Schedules a reconnect attempt unless the app is shutting down. Shared by
   * every failure path (disconnected event, launch failure, init rejection,
   * both watchdog limits) so none of them silently strand the service for
   * the rest of the day. */
  private scheduleReconnect() {
    if (this.shuttingDown) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.initialize(), 5000);
  }

  private async doInitialize() {
    if (this.shuttingDown) return;
    this.clearReadyWatchdog();
    if (this.client) {
      await withTimeout(this.client.destroy(), 10_000).catch((err: unknown) => {
        console.error('Failed to destroy previous WhatsApp client:', err);
      });
      this.client = null;
    }
    if (this.browser) {
      await withTimeout(this.browser.close(), 10_000).catch((err: unknown) => {
        console.error('Failed to close previous WhatsApp browser:', err);
      });
      this.browser = null;
    }

    this.status = 'CONNECTING';
    this.qrCodeData = null;

    // Launch Chrome ourselves via puppeteer-extra + the stealth plugin, then
    // hand whatsapp-web.js the already-running browser's WS endpoint, instead
    // of letting it launch a vanilla puppeteer instance. Plain headless
    // puppeteer sessions were getting silently rejected by WhatsApp's
    // bot-detection: QR codes cycled every ~20s (vs. the normal ~60s) and
    // "authenticated" never fired, even against a freshly re-linked session.
    const browserPath = findBrowserPath();
    if (!browserPath) {
      console.error('No Chromium browser found for WhatsApp (Chrome/Edge not installed?)');
      this.status = 'DISCONNECTED';
      // Chrome/Edge could be installed later, or CHROME_PATH fixed — keep
      // trying rather than stranding the service for the rest of the day.
      this.scheduleReconnect();
      return;
    }

    // WA_DATA_DIR lets the desktop app keep the session somewhere writable
    // (Program Files is read-only for normal users).
    //
    // KNOWN LIMITATION — the WhatsApp login does not currently survive an
    // app restart, and this is why. LocalAuth persists a session purely by
    // setting `userDataDir` on the puppeteer options, but that is a *launch*
    // option, and because we hand whatsapp-web.js an already-running
    // browser's WS endpoint it takes the `puppeteer.connect()` branch
    // (whatsapp-web.js Client.js ~line 447), which ignores it. So LocalAuth
    // creates the folder below and nothing is ever written into it — hence
    // the perpetually empty `.wwebjs_auth/session`.
    //
    // The obvious fix (launch our own browser on that same directory) was
    // tried and reverted — see the note in the launch call above. Solving
    // this properly means either dropping the WS-endpoint approach (which
    // costs the stealth plugin that WhatsApp's bot-detection needs) or
    // driving the login state ourselves; neither is a small change.
    const authDataPath = path.join(process.env.WA_DATA_DIR ?? process.cwd(), '.wwebjs_auth');

    let browserWSEndpoint: string;
    try {
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: browserPath,
        // NOTE: do NOT add `userDataDir` here to try to persist the
        // WhatsApp login. It was tried and reverted (2026-07-28), measured
        // A/B on the same build: with it, whatsapp-web.js's Client.inject()
        // failed every single time with "Execution context was destroyed,
        // most likely because of a navigation" — 6/6 inits failed, the
        // service never reached QR_READY at all, and the UI sat on
        // "Starting WhatsApp…" forever. Without it: 0 failures, QR on the
        // first try. Losing session persistence is bad; never being able to
        // link at all is much worse. See the sessionDir comment below for
        // why persistence does not work through this code path anyway.
        // No --no-sandbox: this Chrome instance renders live WhatsApp Web
        // content (messages/media from arbitrary contacts) — keep the OS
        // sandbox so a renderer exploit doesn't get direct host access.
        // --disable-setuid-sandbox was a Linux-only flag anyway; this app
        // only ships on Windows.
      });
      this.browser = browser;
      browserWSEndpoint = browser.wsEndpoint();
    } catch (err) {
      console.error('Failed to launch stealth-patched Chrome for WhatsApp:', err);
      this.status = 'DISCONNECTED';
      this.scheduleReconnect();
      return;
    }

    this.client = new Client({
      authStrategy: new LocalAuth({
        // WA_DATA_DIR lets the desktop app keep the session in a writable
        // per-user folder (Program Files is read-only for normal users).
        // Same root the browser above launches its profile from — see the
        // userDataDir comment there for why that matters.
        dataPath: authDataPath,
      }),
      puppeteer: {
        browserWSEndpoint,
      },
    });

    this.client.on('qr', async (qr) => {
      try {
        this.status = 'QR_READY';
        this.qrCodeData = await QRCode.toDataURL(qr);
        console.log(`WhatsApp QR generated at ${new Date().toISOString()} (raw len ${qr.length})`);
      } catch (err) {
        console.error('Failed to generate WhatsApp QR Data URL:', err);
      }
    });

    this.client.on('ready', () => {
      this.clearReadyWatchdog();
      this.status = 'CONNECTED';
      this.qrCodeData = null;
      console.log('WhatsApp client is ready and connected!');
    });

    this.client.on('authenticated', () => {
      // The phone has confirmed the scan — the QR shown in Settings is now
      // dead (WhatsApp Web QRs are single-use), so leaving status at
      // QR_READY made the app keep showing it, looking exactly like the scan
      // hadn't worked even though it had. Move to CONNECTING (Settings
      // already renders this as "Starting WhatsApp…") and drop the stale
      // image immediately — 'ready' will flip it to CONNECTED shortly after.
      this.status = 'CONNECTING';
      this.qrCodeData = null;
      console.log('WhatsApp client authenticated successfully');

      // authenticated -> ready is a known whatsapp-web.js quirk that can hang
      // silently on a resumed session — without a bound, an operator who
      // scanned successfully could be stuck on "Starting WhatsApp…" forever
      // with no way back except restarting the whole app.
      this.armReadyWatchdog();
    });

    // Visibility into the authenticated → ready gap — and, critically, proof
    // of LIFE in it: every progress tick re-arms the watchdog below.
    this.client.on('loading_screen', (percent, message) => {
      console.log(`WhatsApp loading: ${percent}% — ${message}`);
      this.armReadyWatchdog();
    });

    this.client.on('change_state', (state) => {
      console.log('WhatsApp connection state changed:', state);
    });

    this.client.on('auth_failure', () => {
      this.clearReadyWatchdog();
      this.status = 'DISCONNECTED';
      this.qrCodeData = null;
      console.warn('WhatsApp authentication failed');
      // whatsapp-web.js destroys the client internally on auth_failure (a
      // failed LocalAuth session restore) without ever emitting
      // 'disconnected' — without this, the service is stranded at
      // DISCONNECTED forever with no reconnect timer and no manual-reconnect
      // route, needing a full app restart to recover.
      this.scheduleReconnect();
    });

    this.client.on('disconnected', () => {
      this.clearReadyWatchdog();
      this.status = 'DISCONNECTED';
      this.qrCodeData = null;
      console.warn('WhatsApp client disconnected. Retrying initialization...');
      // (scheduleReconnect() itself no-ops while shuttingDown — see its
      // comment: a reconnect that starts writing fresh session files right
      // as the process is killed can corrupt the LocalAuth session, forcing
      // an unwanted re-scan of the QR code next launch even though nothing
      // ever called logout().)
      this.scheduleReconnect();
    });

    // whatsapp-web.js's own Client.initialize() calls page.goto(WhatsWebURL,
    // { timeout: 0, ... }) internally — timeout: 0 means NO timeout at all.
    // If that page load ever hangs (a network hiccup, a slow/stuck load,
    // anything), the promise this wraps never settles: not resolved, not
    // rejected. The .catch() below only ever handled a genuine rejection —
    // a hang has none — so the service sat at CONNECTING/"Starting
    // WhatsApp…" forever with no error logged and no retry ever scheduled,
    // since nothing ever fired to trigger one. Confirmed as the actual cause
    // of repeated "stuck on Starting" reports: withTimeout() forces this to
    // fail after a generous but finite wait instead of hanging indefinitely.
    withTimeout(this.client.initialize(), 90_000).catch((err: unknown) => {
      console.error('Failed to initialize WhatsApp client:', err);
      this.status = 'DISCONNECTED';
      // whatsapp-web.js quirks (slow first load, a stuck page) can reject
      // here without ever emitting 'disconnected' — without this, that one
      // rejection permanently strands the service.
      this.scheduleReconnect();
    });
  }

  getStatus(): { status: WhatsAppStatus; qrCode: string | null } {
    return {
      status: this.status,
      qrCode: this.qrCodeData,
    };
  }

  /** Tear down the client and its Chrome process (called on server shutdown). */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearReadyWatchdog();
    // Let any in-flight initialize() finish assigning this.client/this.browser
    // before we tear them down, so a browser it just launched can't outlive
    // this call (doInitialize() itself no-ops further work once shuttingDown
    // is set, so this just waits out the launch already in progress).
    if (this.initPromise) {
      await this.initPromise.catch(() => {});
    }
    if (this.client) {
      await withTimeout(this.client.destroy(), 8_000).catch(() => {});
      this.client = null;
    }
    if (this.browser) {
      await withTimeout(this.browser.close(), 8_000).catch(() => {});
      this.browser = null;
    }
    this.status = 'DISCONNECTED';
  }

  async sendPdfInvoice(
    phone: string,
    pdfBase64: string,
    fileName: string,
    caption?: string,
  ): Promise<void> {
    if (this.status !== 'CONNECTED' || !this.client) {
      throw new Error('WhatsApp is not linked. Please scan the QR code in Settings first.');
    }

    const cleaned = phone.replace(/\D/g, '');
    const recipient = cleaned.length === 10 ? `91${cleaned}@c.us` : `${cleaned}@c.us`;

    const media = new MessageMedia('application/pdf', pdfBase64, fileName);
    // A stuck Chrome page (network drop, WhatsApp Web hang) would otherwise
    // leave this — and the frontend's "sending" spinner — hanging forever.
    await withTimeout(
      this.client.sendMessage(recipient, media, {
        caption:
          caption ??
          `Your invoice ${fileName.replace('.pdf', '')} from The Maestro Studio's. Thank you!`,
      }),
      45_000,
    );
  }
}
