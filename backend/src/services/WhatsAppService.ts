import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { executablePath } from 'puppeteer';

puppeteer.use(StealthPlugin());

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

export class WhatsAppService {
  client: Client | null = null;
  private status: WhatsAppStatus = 'DISCONNECTED';
  private qrCodeData: string | null = null;
  // The Chrome instance we launch ourselves (see initialize). Tracked so
  // re-initialization closes the old browser instead of leaking a process
  // on every reconnect.
  private browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  private initializing = false;

  constructor() {
    this.initialize();
  }

  private async initialize() {
    // The 'disconnected' retry timer can fire while a previous initialize is
    // still in flight — never run two at once or Chrome instances pile up.
    if (this.initializing) return;
    this.initializing = true;
    try {
      await this.doInitialize();
    } finally {
      this.initializing = false;
    }
  }

  private async doInitialize() {
    if (this.client) {
      await this.client.destroy().catch((err: unknown) => {
        console.error('Failed to destroy previous WhatsApp client:', err);
      });
      this.client = null;
    }
    if (this.browser) {
      await this.browser.close().catch((err: unknown) => {
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
      return;
    }

    let browserWSEndpoint: string;
    try {
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: browserPath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      this.browser = browser;
      browserWSEndpoint = browser.wsEndpoint();
    } catch (err) {
      console.error('Failed to launch stealth-patched Chrome for WhatsApp:', err);
      this.status = 'DISCONNECTED';
      return;
    }

    this.client = new Client({
      authStrategy: new LocalAuth({
        // WA_DATA_DIR lets the desktop app keep the session in a writable
        // per-user folder (Program Files is read-only for normal users).
        dataPath: path.join(process.env.WA_DATA_DIR ?? process.cwd(), '.wwebjs_auth'),
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
      this.status = 'CONNECTED';
      this.qrCodeData = null;
      console.log('WhatsApp client is ready and connected!');
    });

    this.client.on('authenticated', () => {
      console.log('WhatsApp client authenticated successfully');
    });

    // Visibility into the authenticated → ready gap, which can otherwise hang
    // silently for minutes (a known whatsapp-web.js quirk on resumed sessions).
    this.client.on('loading_screen', (percent, message) => {
      console.log(`WhatsApp loading: ${percent}% — ${message}`);
    });

    this.client.on('change_state', (state) => {
      console.log('WhatsApp connection state changed:', state);
    });

    this.client.on('auth_failure', () => {
      this.status = 'DISCONNECTED';
      this.qrCodeData = null;
      console.warn('WhatsApp authentication failed');
    });

    this.client.on('disconnected', () => {
      this.status = 'DISCONNECTED';
      this.qrCodeData = null;
      console.warn('WhatsApp client disconnected. Retrying initialization...');
      setTimeout(() => this.initialize(), 5000);
    });

    this.client.initialize().catch((err) => {
      console.error('Failed to initialize WhatsApp client:', err);
      this.status = 'DISCONNECTED';
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
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
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
    await this.client.sendMessage(recipient, media, {
      caption:
        caption ??
        `Your invoice ${fileName.replace('.pdf', '')} from The Maestro Studio's. Thank you!`,
    });
  }
}
